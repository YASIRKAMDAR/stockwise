package app.stockwise.staff

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, val code: String, override val message: String) : Exception(message)
class OfflineException : IOException("No connection")

val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false }

/** Talks to the same Stockwise server as the website. The session cookie is kept in encrypted storage. */
class Api(private val store: Store, private val base: String = BuildConfig.API_BASE) {
    private val jar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            cookies.firstOrNull { it.name == "sw_session" }?.let { c -> store.session = if (c.expiresAt < System.currentTimeMillis()) null else c.value }
        }
        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            val v = store.session ?: return emptyList()
            return listOf(Cookie.Builder().name("sw_session").value(v).domain(url.host).path("/").build())
        }
    }
    private val http = OkHttpClient.Builder().cookieJar(jar).connectTimeout(15, TimeUnit.SECONDS).readTimeout(40, TimeUnit.SECONDS).build()
    private val jsonType = "application/json".toMediaType()

    suspend fun raw(method: String, path: String, body: RequestBody? = null, idemKey: String? = null): String = withContext(Dispatchers.IO) {
        val b = Request.Builder().url(base + path).header("x-requested-with", "stockwise").header("accept", "application/json")
        if (idemKey != null) b.header("idempotency-key", idemKey)
        b.method(method, body ?: if (method == "GET") null else "{}".toRequestBody(jsonType))
        val res = try { http.newCall(b.build()).execute() } catch (e: IOException) { throw OfflineException() }
        res.use { r ->
            val text = r.body?.string() ?: ""
            if (!r.isSuccessful) {
                val err = runCatching { json.decodeFromString(ApiErrorBody.serializer(), text).error }.getOrNull()
                throw ApiException(r.code, err?.code ?: "HTTP_${r.code}", err?.message?.takeIf { it.isNotBlank() } ?: "Something went wrong (${r.code})")
            }
            text
        }
    }
    suspend fun post(path: String, bodyJson: String, idemKey: String? = null) = raw("POST", path, bodyJson.toRequestBody(jsonType), idemKey)

    suspend fun me(): Me = json.decodeFromString(Me.serializer(), raw("GET", "/me"))
    suspend fun products(): List<Product> = json.decodeFromString(raw("GET", "/products"))
    suspend fun rooms(hotelId: String): List<Room> = json.decodeFromString(raw("GET", "/hotels/$hotelId/rooms"))
    suspend fun bag(hotelId: String): BagResponse = json.decodeFromString(raw("GET", "/me/stock?hotelId=$hotelId"))
    suspend fun store(hotelId: String): StoreResponse = json.decodeFromString(raw("GET", "/hotels/$hotelId/stock"))
    suspend fun voiceAttempts(): VoiceAttemptsPage = json.decodeFromString(raw("GET", "/me/voice-attempts?limit=10"))
    suspend fun activity(hotelId: String, limit: Int = 20): ActivityPage = json.decodeFromString(raw("GET", "/transactions?hotelId=$hotelId&limit=$limit"))
    suspend fun setLanguage(lang: String) { raw("PATCH", "/me", """{"language":"$lang"}""".toRequestBody(jsonType)) }
    suspend fun logout() { runCatching { raw("POST", "/auth/logout") }; store.session = null }

    /** Staff sign in with their code and passcode only — no phone setup needed. */
    suspend fun staffLogin(code: String, pin: String) {
        post("/auth/staff-login", json.encodeToString(Login.serializer(), Login(code.trim().uppercase(), pin = pin)))
    }

    /** Typed text (or words heard by the phone); the server reads it the same way as speech. */
    suspend fun interpret(hotelId: String, text: String, lang: String, durationMs: Long): Proposal =
        upload(hotelId, lang, durationMs, "speech.txt", text.toRequestBody("text/plain".toMediaType()))

    /** The recording itself, so Google's model can hear Gujarati, Hindi and English mixed in one sentence. */
    suspend fun interpretAudio(hotelId: String, audio: ByteArray, lang: String, durationMs: Long, heard: String = ""): Proposal =
        upload(hotelId, lang, durationMs, "speech.m4a", audio.toRequestBody("audio/mp4".toMediaType()), heard)

    private suspend fun upload(hotelId: String, lang: String, durationMs: Long, name: String, file: RequestBody, heard: String = ""): Proposal {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("hotelId", hotelId)
            .addFormDataPart("preferredLanguage", when (lang) { "hi" -> "hi-IN"; "gu" -> "gu-IN"; else -> "en-IN" })
            .addFormDataPart("durationMs", durationMs.coerceAtLeast(0).toString())
            .addFormDataPart("client", "android")
            .apply { if (heard.isNotBlank()) addFormDataPart("heard", heard) }   // so the server can still answer if Google is slow
            .addFormDataPart("audio", name, file)
            .build()
        return json.decodeFromString(Proposal.serializer(), raw("POST", "/voice/interpret", body))
    }
}

@kotlinx.serialization.Serializable
data class Login(val employeeCode: String, val password: String? = null, val pin: String? = null, val deviceId: String? = null, val deviceSecret: String? = null)

@kotlinx.serialization.Serializable
data class TxLineBody(val productId: String, val quantity: Int, val roomId: String? = null, val source: String? = null)
@kotlinx.serialization.Serializable
data class TxBody(val action: String, val hotelId: String, val lines: List<TxLineBody>, val proposalId: String? = null)
