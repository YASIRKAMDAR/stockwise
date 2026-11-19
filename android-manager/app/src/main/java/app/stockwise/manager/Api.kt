package app.stockwise.manager

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

val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = false; coerceInputValues = true }

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
    suspend fun stock(hotelId: String): StockResponse = json.decodeFromString(raw("GET", "/hotels/$hotelId/stock"))
    suspend fun alerts(hotelId: String): AlertsResponse = json.decodeFromString(raw("GET", "/dashboard/alerts?hotelId=$hotelId"))
    suspend fun activity(hotelId: String, limit: Int = 40): ActivityPage = json.decodeFromString(raw("GET", "/transactions?hotelId=$hotelId&limit=$limit"))
    suspend fun corrections(hotelId: String): List<CorrectionRequest> = json.decodeFromString(raw("GET", "/correction-requests?hotelId=$hotelId"))
    suspend fun voiceAttempts(): VoiceAttemptsPage = json.decodeFromString(raw("GET", "/me/voice-attempts?limit=10"))
    suspend fun setLanguage(lang: String) { raw("PATCH", "/me", """{"language":"$lang"}""".toRequestBody(jsonType)) }
    suspend fun logout() { runCatching { raw("POST", "/auth/logout") }; store.session = null }

    /** Managers sign in with their employee code and password, as on the website. */
    suspend fun login(code: String, password: String) {
        post("/auth/login", json.encodeToString(Login.serializer(), Login(code.trim().uppercase(), password)))
    }

    // Weekly count
    suspend fun countStatus(hotelId: String): List<CountStatus> = json.decodeFromString(raw("GET", "/counts/status?hotelId=$hotelId"))
    suspend fun startCount(hotelId: String): CountSheet = json.decodeFromString(CountSheet.serializer(), post("/counts", """{"hotelId":"$hotelId"}"""))
    suspend fun count(id: String): CountSheet = json.decodeFromString(CountSheet.serializer(), raw("GET", "/counts/$id"))
    suspend fun counts(hotelId: String): List<CountSummary> = json.decodeFromString(raw("GET", "/counts?hotelId=$hotelId"))
    suspend fun patchCount(id: String, lines: List<CountPatchLine>): CountSheet =
        json.decodeFromString(CountSheet.serializer(), raw("PATCH", "/counts/$id/lines", json.encodeToString(CountPatch.serializer(), CountPatch(lines)).toRequestBody(jsonType)))
    suspend fun submitCount(id: String, key: String) { post("/counts/$id/submit", "{}", key) }
    suspend fun cancelCount(id: String) { post("/counts/$id/cancel", "{}") }
    suspend fun refreshCount(id: String) { post("/counts/$id/refresh", "{}") }

    // Deliveries between hotels
    suspend fun transfers(hotelId: String): List<Transfer> = json.decodeFromString(raw("GET", "/transfers?hotelId=$hotelId"))
    suspend fun receive(id: String, lines: List<ReceiveLine>, final: Boolean, key: String) { post("/transfers/$id/receipts", json.encodeToString(ReceiveBody.serializer(), ReceiveBody(lines, final)), key) }
    suspend fun resolve(id: String, reason: String, key: String) { post("/transfers/$id/resolve", """{"reason":"$reason"}""", key) }
    suspend fun dispatch(from: String, to: String, lines: List<DispatchLine>, key: String) { post("/transfers", json.encodeToString(DispatchBody.serializer(), DispatchBody(from, to, lines)), key) }

    // Requests to the warehouse
    suspend fun requests(hotelId: String): List<StockRequest> = json.decodeFromString(raw("GET", "/requests?hotelId=$hotelId"))
    suspend fun topUp(hotelId: String): TopUp = json.decodeFromString(TopUp.serializer(), raw("GET", "/requests/top-up?hotelId=$hotelId"))
    suspend fun createRequest(hotelId: String, lines: List<DispatchLine>, note: String? = null) { post("/requests", json.encodeToString(AskBody.serializer(), AskBody(hotelId, lines, note))) }
    suspend fun dispatchRequest(id: String, lines: List<DispatchLine>?, key: String) { post("/requests/$id/dispatch", json.encodeToString(DispatchRequestBody.serializer(), DispatchRequestBody(lines)), key) }
    suspend fun declineRequest(id: String, note: String? = null) { post("/requests/$id/decline", json.encodeToString(NoteBody.serializer(), NoteBody(note))) }
    suspend fun schedules(hotelId: String): List<RequestSchedule> = json.decodeFromString(raw("GET", "/request-schedules?hotelId=$hotelId"))
    suspend fun addSchedule(hotelId: String, weekday: Int, hour: Int) { post("/request-schedules", json.encodeToString(ScheduleBody.serializer(), ScheduleBody(hotelId, weekday, hour))) }
    suspend fun deleteSchedule(id: String) { raw("DELETE", "/request-schedules/$id") }

    // Catalog, suppliers, orders to suppliers, deliveries
    private fun enc(v: String) = java.net.URLEncoder.encode(v, "UTF-8")
    suspend fun categories(): List<Category> = json.decodeFromString(raw("GET", "/catalog/categories"))
    suspend fun items(siteId: String, q: String = "", filter: String? = null): ItemsPage =
        json.decodeFromString(ItemsPage.serializer(), raw("GET", "/catalog/items?siteId=$siteId&limit=60" + (if (q.isNotBlank()) "&q=" + enc(q) else "") + (filter?.let { "&filter=$it" } ?: "")))
    suspend fun createItem(name: String, unit: String, categoryId: String?): Created =
        json.decodeFromString(Created.serializer(), post("/catalog/items", json.encodeToString(NewItem.serializer(), NewItem(name, unit, categoryId))))
    suspend fun suppliers(q: String = ""): List<Supplier> = json.decodeFromString(raw("GET", "/suppliers" + if (q.isNotBlank()) "?q=" + enc(q) else ""))
    suspend fun supplier(id: String): Supplier = json.decodeFromString(Supplier.serializer(), raw("GET", "/suppliers/$id"))
    suspend fun createSupplier(b: SupplierBody): Created = json.decodeFromString(Created.serializer(), post("/suppliers", json.encodeToString(SupplierBody.serializer(), b)))
    suspend fun patchSupplier(id: String, b: SupplierBody) { raw("PATCH", "/suppliers/$id", json.encodeToString(SupplierBody.serializer(), b).toRequestBody(jsonType)) }
    suspend fun supplierItems(id: String, categoryId: String): List<PickItem> = json.decodeFromString(raw("GET", "/suppliers/$id/categories/$categoryId/items"))
    suspend fun setSupplierCategory(id: String, categoryId: String, allItems: Boolean, productIds: List<String>) {
        raw("PUT", "/suppliers/$id/categories/$categoryId", json.encodeToString(CategoryPick.serializer(), CategoryPick(allItems, productIds)).toRequestBody(jsonType))
    }
    suspend fun siteHome(siteId: String): SiteHome = json.decodeFromString(SiteHome.serializer(), raw("GET", "/sites/$siteId/home"))
    suspend fun suggest(siteId: String, supplierId: String?): List<Suggestion> = json.decodeFromString(raw("GET", "/orders/suggest?siteId=$siteId" + (supplierId?.let { "&supplierId=$it" } ?: "")))
    suspend fun createOrder(siteId: String, supplierId: String, lines: List<DispatchLine>, source: String): Created =
        json.decodeFromString(Created.serializer(), post("/orders", json.encodeToString(NewOrder.serializer(), NewOrder(siteId, supplierId, lines, source))))
    suspend fun patchOrder(id: String, supplierId: String, lines: List<DispatchLine>) { raw("PATCH", "/orders/$id", json.encodeToString(OrderPatch.serializer(), OrderPatch(lines, supplierId)).toRequestBody(jsonType)) }
    suspend fun order(id: String): Order = json.decodeFromString(Order.serializer(), raw("GET", "/orders/$id"))
    suspend fun sendOrder(id: String): Order = json.decodeFromString(Order.serializer(), post("/orders/$id/send", "{}"))
    suspend fun draftOrder(siteId: String, text: String, supplierId: String? = null): OrderDraft = json.decodeFromString(OrderDraft.serializer(), post("/orders/draft-from-text", json.encodeToString(DraftAsk.serializer(), DraftAsk(siteId, text, supplierId))))
    suspend fun checkIn(orderId: String, lines: List<DeliveryLineBody>, key: String): DeliveryResult =
        json.decodeFromString(DeliveryResult.serializer(), post("/orders/$orderId/deliveries", json.encodeToString(DeliveryBody.serializer(), DeliveryBody(lines)), key))
    suspend fun uploadPhoto(deliveryId: String, kind: String, jpeg: ByteArray) {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("kind", kind).addFormDataPart("photo", "photo.jpg", jpeg.toRequestBody("image/jpeg".toMediaType())).build()
        raw("POST", "/deliveries/$deliveryId/photos", body)
    }

    // Activity
    suspend fun reverse(eventId: String, reason: String, key: String) { post("/transactions/$eventId/reversal", json.encodeToString(ReasonBody.serializer(), ReasonBody(reason)), key) }
    suspend fun dismissCorrection(id: String) { post("/correction-requests/$id/dismiss", "{}") }

    /** Typed text (or words heard by the phone); the server reads it the same way as speech. */
    suspend fun interpret(hotelId: String, text: String, lang: String, durationMs: Long, mode: String? = null): Proposal =
        upload(hotelId, lang, durationMs, "speech.txt", text.toRequestBody("text/plain".toMediaType()), mode = mode)

    /** The recording itself, so Google's model can hear Gujarati, Hindi and English mixed in one sentence. */
    suspend fun interpretAudio(hotelId: String, audio: ByteArray, lang: String, durationMs: Long, heard: String = "", mode: String? = null): Proposal =
        upload(hotelId, lang, durationMs, "speech.m4a", audio.toRequestBody("audio/mp4".toMediaType()), heard, mode)

    private suspend fun upload(hotelId: String, lang: String, durationMs: Long, name: String, file: RequestBody, heard: String = "", mode: String? = null): Proposal {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("hotelId", hotelId)
            .addFormDataPart("preferredLanguage", localeTag(lang))
            .addFormDataPart("durationMs", durationMs.coerceAtLeast(0).toString())
            .addFormDataPart("client", "android-manager")
            .addFormDataPart("scope", "all")                                      // a manager may ask about another hotel they can see
            .apply { if (mode != null) addFormDataPart("mode", mode) }           // "count": numbers are physical counts, not movements
            .apply { if (heard.isNotBlank()) addFormDataPart("heard", heard) }   // so the server can still answer if Google is slow
            .addFormDataPart("audio", name, file)
            .build()
        return json.decodeFromString(Proposal.serializer(), raw("POST", "/voice/interpret", body))
    }
}

@kotlinx.serialization.Serializable data class Login(val employeeCode: String, val password: String)
@kotlinx.serialization.Serializable data class CountPatchLine(val productId: String, val physicalQty: Int?, val reason: String? = null)
@kotlinx.serialization.Serializable data class CountPatch(val lines: List<CountPatchLine>)
@kotlinx.serialization.Serializable data class ReceiveLine(val productId: String, val receivedQuantity: Int)
@kotlinx.serialization.Serializable data class ReceiveBody(val lines: List<ReceiveLine>, val final: Boolean)
@kotlinx.serialization.Serializable data class DispatchLine(val productId: String, val quantity: Int)
@kotlinx.serialization.Serializable data class DispatchBody(val fromHotelId: String, val toHotelId: String, val lines: List<DispatchLine>)
@kotlinx.serialization.Serializable data class ReasonBody(val reason: String)
@kotlinx.serialization.Serializable data class NewItem(val name: String, val unit: String, val categoryId: String? = null)
@kotlinx.serialization.Serializable data class SupplierBody(val name: String? = null, val phone: String? = null, val deliveryDays: Int? = null, val favourite: Boolean? = null, val categoryIds: List<String>? = null)
@kotlinx.serialization.Serializable data class CategoryPick(val allItems: Boolean, val productIds: List<String>)
@kotlinx.serialization.Serializable data class NewOrder(val siteId: String, val supplierId: String, val lines: List<DispatchLine>, val source: String)
@kotlinx.serialization.Serializable data class OrderPatch(val lines: List<DispatchLine>, val supplierId: String)
@kotlinx.serialization.Serializable data class DraftAsk(val siteId: String, val text: String, val supplierId: String? = null)
@kotlinx.serialization.Serializable data class DeliveryLineBody(val productId: String, val received: Int, val rejected: Int = 0, val rejectReason: String? = null, val unitPrice: Double? = null, val expiryDate: String? = null)
@kotlinx.serialization.Serializable data class DeliveryBody(val lines: List<DeliveryLineBody>)
@kotlinx.serialization.Serializable data class AskBody(val hotelId: String, val lines: List<DispatchLine>, val note: String? = null)
@kotlinx.serialization.Serializable data class DispatchRequestBody(val lines: List<DispatchLine>? = null)
@kotlinx.serialization.Serializable data class NoteBody(val note: String? = null)
@kotlinx.serialization.Serializable data class ScheduleBody(val hotelId: String, val weekday: Int, val hour: Int)
