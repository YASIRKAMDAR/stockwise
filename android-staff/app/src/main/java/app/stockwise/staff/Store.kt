package app.stockwise.staff

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

/** A job saved on the phone while offline; sent later with the same idempotency key so it can't be recorded twice. */
@Serializable data class Pending(val key: String, val body: String, val label: String, val createdAt: Long, val error: String? = null)

/** Encrypted on-device storage: phone setup, session, language, recent rooms and the offline queue. */
class Store(ctx: Context) {
    private val prefs: SharedPreferences = try {
        val mk = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(ctx, "stockwise", mk, EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    } catch (e: Exception) { ctx.getSharedPreferences("stockwise_plain", Context.MODE_PRIVATE) }

    var session: String?
        get() = prefs.getString("session", null)
        set(v) { prefs.edit().apply { if (v == null) remove("session") else putString("session", v) }.apply() }
    var lang: String
        get() = prefs.getString("lang", "en") ?: "en"
        set(v) { prefs.edit().putString("lang", v).apply() }
    var introSeen: Boolean
        get() = prefs.getBoolean("introSeen", false)
        set(v) { prefs.edit().putBoolean("introSeen", v).apply() }
    var lastCode: String
        get() = prefs.getString("lastCode", "") ?: ""
        set(v) { prefs.edit().putString("lastCode", v).apply() }
    fun recentRooms(userId: String): List<String> = prefs.getString("rooms_$userId", "")!!.split(",").filter { it.isNotBlank() }
    fun addRecentRooms(userId: String, rooms: List<String>) {
        val next = (rooms + recentRooms(userId).filter { it !in rooms }).take(6)
        prefs.edit().putString("rooms_$userId", next.joinToString(",")).apply()
    }
    private val qs = ListSerializer(Pending.serializer())
    var outbox: List<Pending>
        get() = prefs.getString("outbox", null)?.let { runCatching { json.decodeFromString(qs, it) }.getOrNull() } ?: emptyList()
        set(v) { prefs.edit().putString("outbox", json.encodeToString(qs, v)).apply() }
    @Synchronized fun enqueue(p: Pending) { outbox = outbox.filter { it.key != p.key } + p }
    @Synchronized fun dequeue(key: String) { outbox = outbox.filter { it.key != key } }
    @Synchronized fun markFailed(key: String, error: String) { outbox = outbox.map { if (it.key == key) it.copy(error = error) else it } }
}
