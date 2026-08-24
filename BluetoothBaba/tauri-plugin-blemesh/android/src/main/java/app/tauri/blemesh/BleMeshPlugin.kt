// SPDX-License-Identifier: MIT
//
// MeshChat — dual-role BLE mesh transport (BitChat model).
//
// Every device runs BOTH roles at once:
//   • Peripheral: advertises a service UUID + runs a GATT server whose single
//     characteristic accepts writes and pushes notifications.
//   • Central: scans for that same service UUID, connects to peers it finds,
//     subscribes to their notifications, and writes to their characteristic.
//
// A "send" therefore fans a frame out to every connected neighbour over
// whichever role that link uses. This class is a dumb radio pipe: framing,
// TTL/relay, dedup, identity and encryption all live in Rust. Inbound frames
// are surfaced to JS via trigger("packet", { data: <base64> }); the frontend
// forwards them straight back to the app's `on_packet` command.
//
// NOTE: the radio path cannot be exercised in CI or an emulator — it needs two
// physical phones. What CI verifies is that this compiles and links.

package app.tauri.blemesh

import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.ArrayDeque
import java.util.UUID

@InvokeArg
class SendArgs {
    lateinit var data: String // base64-encoded wire frame
}

@TauriPlugin
class BleMeshPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val TAG = "BleMesh"

        // App-specific 128-bit UUIDs ("meshchat" + role bytes).
        private val SERVICE_UUID: UUID = UUID.fromString("6d657368-6368-6174-424c-450000000001")
        private val CHAR_UUID: UUID = UUID.fromString("6d657368-6368-6174-424c-450000000002")
        private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        private const val DEFAULT_MTU = 23
        private const val MAX_FRAME = 64 * 1024 // reassembly guard against desync
        private const val PERM_REQUEST_CODE = 0xB1E
    }

    private val main = Handler(Looper.getMainLooper())

    private var adapter: BluetoothAdapter? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null
    private var gattServer: BluetoothGattServer? = null
    private var notifyChar: BluetoothGattCharacteristic? = null

    @Volatile
    private var running = false

    // Central role: outbound GATT connections we opened to peers' servers.
    private val clientGatts = HashMap<String, BluetoothGatt>()
    private val clientChars = HashMap<String, BluetoothGattCharacteristic>()
    private val connecting = HashSet<String>()

    // Peripheral role: centrals currently subscribed to our notifications.
    private val subscribers = HashMap<String, BluetoothDevice>()

    // Per-link negotiated payload size and outbound queues (simple back-pressure:
    // one chunk in flight per link, next sent on the write/notify callback).
    private val linkChunk = HashMap<String, Int>()
    private val clientQueue = HashMap<String, ArrayDeque<ByteArray>>()
    private val clientBusy = HashSet<String>()
    private val serverQueue = HashMap<String, ArrayDeque<ByteArray>>()
    private val serverBusy = HashSet<String>()

    // Reassembly buffers keyed by peer address (length-prefixed frame stream).
    private val rxBuffer = HashMap<String, ByteArray>()

    // ------------------------------------------------------------------ commands

    @Command
    fun start(invoke: Invoke) {
        if (running) {
            invoke.resolve()
            return
        }
        val missing = missingPermissions()
        if (missing.isNotEmpty()) {
            activity.requestPermissions(missing.toTypedArray(), PERM_REQUEST_CODE)
            invoke.reject("Grant Bluetooth (and, on older phones, Location) permissions, then turn the mesh on again.")
            return
        }

        val mgr = activity.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val ad = mgr?.adapter
        if (ad == null) {
            invoke.reject("This device has no Bluetooth adapter.")
            return
        }
        if (!ad.isEnabled) {
            invoke.reject("Bluetooth is off. Turn it on and try again.")
            return
        }
        adapter = ad

        try {
            startGattServer(mgr)
            startAdvertising()
            startScanning()
            running = true
            Log.i(TAG, "mesh started")
            invoke.resolve()
        } catch (e: SecurityException) {
            invoke.reject("Missing Bluetooth permission: ${e.message}")
        } catch (e: Exception) {
            invoke.reject("Failed to start BLE mesh: ${e.message}")
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        teardown()
        invoke.resolve()
    }

    @Command
    fun send(invoke: Invoke) {
        val args = invoke.parseArgs(SendArgs::class.java)
        val frame = try {
            Base64.decode(args.data, Base64.NO_WRAP)
        } catch (e: Exception) {
            invoke.reject("Invalid base64 frame: ${e.message}")
            return
        }
        broadcast(frame)
        invoke.resolve()
    }

    // ------------------------------------------------------------------ peripheral

    @SuppressLint("MissingPermission")
    private fun startGattServer(mgr: BluetoothManager) {
        val server = mgr.openGattServer(activity, serverCallback) ?: return
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val ch = BluetoothGattCharacteristic(
            CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        val cccd = BluetoothGattDescriptor(
            CCCD_UUID,
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        )
        ch.addDescriptor(cccd)
        service.addCharacteristic(ch)
        server.addService(service)
        gattServer = server
        notifyChar = ch
    }

    @SuppressLint("MissingPermission")
    private fun startAdvertising() {
        val adv = adapter?.bluetoothLeAdvertiser
        if (adv == null) {
            Log.w(TAG, "BLE advertising unsupported on this device")
            return
        }
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build()
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()
        adv.startAdvertising(settings, data, advertiseCallback)
        advertiser = adv
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartFailure(errorCode: Int) {
            Log.e(TAG, "advertise failed: $errorCode")
        }
    }

    private val serverCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                val addr = device.address
                subscribers.remove(addr)
                serverQueue.remove(addr)
                serverBusy.remove(addr)
                rxBuffer.remove(addr)
            }
        }

        @SuppressLint("MissingPermission")
        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            onChunk(device.address, value)
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }

        @SuppressLint("MissingPermission")
        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            if (descriptor.uuid == CCCD_UUID) {
                val enable = value.isNotEmpty() && value[0].toInt() != 0
                if (enable) subscribers[device.address] = device else subscribers.remove(device.address)
            }
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            linkChunk[device.address] = (mtu - 3).coerceAtLeast(DEFAULT_MTU - 3)
        }

        override fun onNotificationSent(device: BluetoothDevice, status: Int) {
            serverBusy.remove(device.address)
            drainServer(device)
        }
    }

    // ------------------------------------------------------------------ central

    @SuppressLint("MissingPermission")
    private fun startScanning() {
        val sc = adapter?.bluetoothLeScanner
        if (sc == null) {
            Log.w(TAG, "BLE scanning unsupported on this device")
            return
        }
        val filters = listOf(
            ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
        )
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        sc.startScan(filters, settings, scanCallback)
        scanner = sc
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            connectToPeer(result.device)
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "scan failed: $errorCode")
        }
    }

    @SuppressLint("MissingPermission")
    private fun connectToPeer(device: BluetoothDevice) {
        val addr = device.address
        if (clientGatts.containsKey(addr) || connecting.contains(addr)) return
        connecting.add(addr)
        device.connectGatt(activity, false, clientCallback, BluetoothDevice.TRANSPORT_LE)
    }

    private val clientCallback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val addr = gatt.device.address
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                clientGatts[addr] = gatt
                connecting.remove(addr)
                gatt.requestMtu(517)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                cleanupClient(addr)
                try {
                    gatt.close()
                } catch (_: Exception) {
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            linkChunk[gatt.device.address] = (mtu - 3).coerceAtLeast(DEFAULT_MTU - 3)
            gatt.discoverServices()
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            val ch = gatt.getService(SERVICE_UUID)?.getCharacteristic(CHAR_UUID) ?: return
            clientChars[gatt.device.address] = ch
            gatt.setCharacteristicNotification(ch, true)
            val cccd = ch.getDescriptor(CCCD_UUID) ?: return
            cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            gatt.writeDescriptor(cccd)
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray
        ) {
            onChunk(gatt.device.address, value)
        }

        @Deprecated("Compat path for API < 33")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            @Suppress("DEPRECATION")
            characteristic.value?.let { onChunk(gatt.device.address, it) }
        }

        override fun onCharacteristicWrite(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int
        ) {
            val addr = gatt.device.address
            clientBusy.remove(addr)
            drainClient(addr)
        }
    }

    // ------------------------------------------------------------------ transmit

    /** Frame a payload (4-byte big-endian length prefix) and queue it to all links. */
    private fun broadcast(frame: ByteArray) {
        if (!running) return
        val prefixed = ByteArray(4 + frame.size)
        prefixed[0] = (frame.size ushr 24 and 0xFF).toByte()
        prefixed[1] = (frame.size ushr 16 and 0xFF).toByte()
        prefixed[2] = (frame.size ushr 8 and 0xFF).toByte()
        prefixed[3] = (frame.size and 0xFF).toByte()
        System.arraycopy(frame, 0, prefixed, 4, frame.size)

        // Central links: write to each peer's characteristic.
        for (addr in clientChars.keys.toList()) {
            val q = clientQueue.getOrPut(addr) { ArrayDeque() }
            for (chunk in chunk(prefixed, addr)) q.add(chunk)
            drainClient(addr)
        }
        // Peripheral links: notify each subscribed central.
        for ((_, device) in subscribers.toList()) {
            val q = serverQueue.getOrPut(device.address) { ArrayDeque() }
            for (chunk in chunk(prefixed, device.address)) q.add(chunk)
            drainServer(device)
        }
    }

    private fun chunk(data: ByteArray, addr: String): List<ByteArray> {
        val size = (linkChunk[addr] ?: (DEFAULT_MTU - 3)).coerceAtLeast(20)
        val out = ArrayList<ByteArray>((data.size / size) + 1)
        var i = 0
        while (i < data.size) {
            val end = minOf(i + size, data.size)
            out.add(data.copyOfRange(i, end))
            i = end
        }
        return out
    }

    @SuppressLint("MissingPermission")
    private fun drainClient(addr: String) {
        if (clientBusy.contains(addr)) return
        val q = clientQueue[addr] ?: return
        val chunk = q.poll() ?: return
        val gatt = clientGatts[addr] ?: return
        val ch = clientChars[addr] ?: return
        clientBusy.add(addr)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(ch, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
            } else {
                @Suppress("DEPRECATION")
                run {
                    ch.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                    ch.value = chunk
                    gatt.writeCharacteristic(ch)
                }
            }
        } catch (e: Exception) {
            clientBusy.remove(addr)
            Log.e(TAG, "write failed to $addr: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    private fun drainServer(device: BluetoothDevice) {
        val addr = device.address
        if (serverBusy.contains(addr)) return
        val q = serverQueue[addr] ?: return
        val chunk = q.poll() ?: return
        val ch = notifyChar ?: return
        val server = gattServer ?: return
        serverBusy.add(addr)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                server.notifyCharacteristicChanged(device, ch, false, chunk)
            } else {
                @Suppress("DEPRECATION")
                run {
                    ch.value = chunk
                    server.notifyCharacteristicChanged(device, ch, false)
                }
            }
        } catch (e: Exception) {
            serverBusy.remove(addr)
            Log.e(TAG, "notify failed to $addr: ${e.message}")
        }
    }

    // ------------------------------------------------------------------ receive

    /** Append received bytes for a link and emit any completed frames. */
    private fun onChunk(addr: String, bytes: ByteArray) {
        val prev = rxBuffer[addr]
        var buf = if (prev == null) bytes.copyOf() else prev + bytes
        while (buf.size >= 4) {
            val len = ((buf[0].toInt() and 0xFF) shl 24) or
                ((buf[1].toInt() and 0xFF) shl 16) or
                ((buf[2].toInt() and 0xFF) shl 8) or
                (buf[3].toInt() and 0xFF)
            if (len < 0 || len > MAX_FRAME) {
                // Desync/corruption — drop this link's buffer and resync.
                buf = ByteArray(0)
                break
            }
            if (buf.size < 4 + len) break
            val frame = buf.copyOfRange(4, 4 + len)
            emitPacket(frame)
            buf = buf.copyOfRange(4 + len, buf.size)
        }
        if (buf.isEmpty()) rxBuffer.remove(addr) else rxBuffer[addr] = buf
    }

    private fun emitPacket(frame: ByteArray) {
        val b64 = Base64.encodeToString(frame, Base64.NO_WRAP)
        main.post {
            val payload = JSObject()
            payload.put("data", b64)
            trigger("packet", payload)
        }
    }

    // ------------------------------------------------------------------ lifecycle

    @SuppressLint("MissingPermission")
    private fun teardown() {
        running = false
        try {
            advertiser?.stopAdvertising(advertiseCallback)
        } catch (_: Exception) {
        }
        try {
            scanner?.stopScan(scanCallback)
        } catch (_: Exception) {
        }
        for ((_, gatt) in clientGatts) {
            try {
                gatt.close()
            } catch (_: Exception) {
            }
        }
        try {
            gattServer?.close()
        } catch (_: Exception) {
        }
        clientGatts.clear()
        clientChars.clear()
        connecting.clear()
        subscribers.clear()
        clientQueue.clear()
        clientBusy.clear()
        serverQueue.clear()
        serverBusy.clear()
        linkChunk.clear()
        rxBuffer.clear()
        advertiser = null
        scanner = null
        gattServer = null
        notifyChar = null
        Log.i(TAG, "mesh stopped")
    }

    private fun cleanupClient(addr: String) {
        clientGatts.remove(addr)
        clientChars.remove(addr)
        connecting.remove(addr)
        clientQueue.remove(addr)
        clientBusy.remove(addr)
        rxBuffer.remove(addr)
    }

    private fun missingPermissions(): List<String> {
        val needed = ArrayList<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            needed.add("android.permission.BLUETOOTH_SCAN")
            needed.add("android.permission.BLUETOOTH_ADVERTISE")
            needed.add("android.permission.BLUETOOTH_CONNECT")
        } else {
            needed.add("android.permission.ACCESS_FINE_LOCATION")
        }
        return needed.filter {
            ContextCompat.checkSelfPermission(activity, it) != PackageManager.PERMISSION_GRANTED
        }
    }
}
