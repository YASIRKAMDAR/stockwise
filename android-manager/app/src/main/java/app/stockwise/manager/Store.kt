package app.stockwise.manager

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Encrypted on-device storage: session, language, chosen hotel, whether the walkthrough was seen. */
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
    var hotelId: String?
        get() = prefs.getString("hotelId", null)
        set(v) { prefs.edit().apply { if (v == null) remove("hotelId") else putString("hotelId", v) }.apply() }
}
