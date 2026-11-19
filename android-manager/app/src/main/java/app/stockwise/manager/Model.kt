package app.stockwise.manager

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// Server shapes (same API as the website). Only the fields the app reads.
@Serializable data class Hotel(val id: String, val name: String, val code: String = "", val timezone: String = "Asia/Kolkata", val kind: String = "HOTEL", val roles: List<String> = emptyList()) {
    val isWarehouse get() = kind == "WAREHOUSE"
}
@Serializable data class MeConfig(val voiceProvider: String = "disabled", val voiceMaxSeconds: Int = 25)
@Serializable data class Me(val id: String, val displayName: String, val employeeCode: String = "", val role: String = "STAFF", val language: String = "en", val hotels: List<Hotel> = emptyList(), val config: MeConfig = MeConfig(), val warehouseId: String? = null)
@Serializable data class Alias(val locale: String, val alias: String)
@Serializable data class Product(val id: String, val sku: String, val name: String, val unit: String = "", val icon: String? = null, val active: Boolean = true, val aliases: List<Alias> = emptyList())

/** One product at one hotel: store level, what staff carry, and the reorder line. */
@Serializable data class StockRow(val productId: String, val name: String, val icon: String? = null, val unit: String = "", val store: Int = 0, val staffHeld: Int = 0,
    val inTransitIn: Int = 0, val inTransitOut: Int = 0, val reorderThreshold: Int = 0, val low: Boolean = false, val out: Boolean = false)
@Serializable data class StockResponse(val items: List<StockRow> = emptyList())
@Serializable data class Alert(val id: String, val severity: String, val category: String, val hotelId: String, val title: String, val detail: String = "", val createdAt: String? = null)
@Serializable data class AlertsResponse(val items: List<Alert> = emptyList())

@Serializable data class CountStatus(val hotelId: String, val state: String = "DUE", val lastSubmittedAt: String? = null, val draftCountId: String? = null)
@Serializable data class CountLine(val productId: String, val name: String, val icon: String? = null, val unit: String = "", val expectedQty: Int = 0, val physicalQty: Int? = null,
    val reason: String? = null, val variance: Int? = null, val changedSinceSnapshot: Boolean = false)
@Serializable data class CountSheet(val id: String, val status: String = "DRAFT", val startedAt: String? = null, val lines: List<CountLine> = emptyList(), val changedCount: Int = 0)
@Serializable data class CountSummary(val id: String, val status: String = "", val submittedAt: String? = null, val startedAt: String? = null, val absVariance: Int? = null, val expected: Int? = null)

@Serializable data class TransferLine(val productId: String, val name: String, val unit: String = "", val sent: Int = 0, val received: Int = 0, val resolvedShort: Int = 0)
@Serializable data class NamedRef(val id: String, val name: String)
@Serializable data class Transfer(val id: String, val refCode: String, val status: String, val dispatchedAt: String? = null, val note: String? = null, val fromHotel: NamedRef, val toHotel: NamedRef,
    val dispatchedBy: NamedRef? = null, val lines: List<TransferLine> = emptyList(), val outstandingUnits: Int = 0, val ageHours: Double = 0.0, val aged: Boolean = false)

/** A hotel asking the warehouse for stock. OPEN until the warehouse sends (SENT, with a transfer) or declines. */
@Serializable data class RequestLine(val productId: String, val name: String, val unit: String = "", val quantity: Int = 0, val warehouseStock: Int = 0)
@Serializable data class StockRequest(val id: String, val status: String, val note: String? = null, val createdAt: String? = null, val transferId: String? = null, val transferRef: String? = null,
    val hotel: NamedRef, val warehouse: NamedRef, val requestedBy: String = "", val lines: List<RequestLine> = emptyList(), val ageHours: Double = 0.0)
/** What a hotel would ask for to get back to par. */
@Serializable data class TopUpLine(val productId: String, val name: String, val par: Int = 0, val store: Int = 0, val onTheWay: Int = 0, val requested: Int = 0, val warehouse: Int = 0, val quantity: Int = 0)
@Serializable data class TopUp(val warehouse: NamedRef, val lines: List<TopUpLine> = emptyList())
@Serializable data class RequestSchedule(val id: String, val hotel: NamedRef, val weekday: Int, val hour: Int, val active: Boolean = true, val lastRunAt: String? = null)

@Serializable data class EventLine(val productId: String? = null, val name: String = "", val quantity: Int = 0, val roomNumber: String? = null)
@Serializable data class Who(val name: String = "", val code: String = "")
@Serializable data class Event(val eventId: String, val action: String, val createdAt: String, val note: String? = null, val reason: String? = null, val hotelName: String? = null,
    val actor: Who? = null, val reversalOf: String? = null, val reversedBy: String? = null, val viaVoice: Boolean = false, val lines: List<EventLine>? = null)
@Serializable data class ActivityPage(val items: List<Event> = emptyList(), val nextCursor: String? = null)
@Serializable data class CorrectionRequest(val id: String, val eventId: String, val note: String = "", val createdAt: String? = null, val requestedByName: String? = null, val displayName: String? = null, val status: String? = null)

@Serializable data class ProposalLine(val productId: String? = null, val productName: String? = null, val spokenProduct: String = "", val quantity: Int? = null, val roomNumber: String? = null, val issues: List<String> = emptyList())
@Serializable data class QueryRow(val productId: String = "", val name: String, val unit: String = "", val store: Int = 0, val staffHeld: Int = 0, val inTransit: Int = 0, val hotelName: String = "", val low: Boolean = false)
@Serializable data class Proposal(val proposalId: String? = null, val status: String, val transcript: String = "", val action: String = "UNKNOWN", val targetHotelId: String? = null,
    val lines: List<ProposalLine> = emptyList(), val queryResult: List<QueryRow>? = null, val clarificationQuestion: String? = null, val detectedLanguage: String? = null, val warnings: List<String> = emptyList())

@Serializable data class VoiceAttempt(val createdAt: String, val status: String, val errorCode: String? = null, val language: String? = null, val client: String? = null,
    val inputKind: String? = null, val fallback: String? = null, val latencyMs: Int? = null, val transcript: String? = null, val action: String? = null, val confirmed: Boolean? = null)
@Serializable data class VoiceAttemptsPage(val attempts: List<VoiceAttempt> = emptyList())
@Serializable data class ApiErrorBody(val error: ApiErrorInner? = null)
@Serializable data class ApiErrorInner(val code: String = "", val message: String = "", val details: JsonElement? = null)

// ---- catalog, suppliers, orders to suppliers, deliveries ----
@Serializable data class Category(val id: String, val name: String = "", val shortName: String = "", val items: Int = 0)
@Serializable data class SupplierTag(val id: String, val name: String, val more: Int = 0)
@Serializable data class UseFirst(val by: String? = null, val quantity: Int = 0)
@Serializable data class CatalogItem(val id: String, val code: String = "", val name: String, val unit: String = "", val photoUrl: String? = null, val category: String? = null, val categoryId: String? = null,
    val store: Int = 0, val min: Int = 0, val par: Int = 0, val lastPrice: Double? = null, val hasExpiry: Boolean = false, val status: String = "NONE", val useFirst: UseFirst? = null, val supplier: SupplierTag? = null)
@Serializable data class ItemsPage(val total: Int = 0, val items: List<CatalogItem> = emptyList())
@Serializable data class SupplierCat(val id: String, val name: String, val allItems: Boolean = true, val picked: Int = 0, val orders: Int = 0, val boughtBefore: Boolean = false)
@Serializable data class SupplierOrder(val id: String, val number: Int, val status: String, val items: String? = null, val total: Double = 0.0, val sentAt: String? = null, val createdAt: String? = null)
@Serializable data class BoughtItem(val id: String, val name: String, val unit: String = "", val times: Int = 0, val lastPrice: Double? = null)
@Serializable data class Supplier(val id: String, val name: String, val phone: String? = null, val onWhatsapp: Boolean = true, val deliveryDays: Int? = null, val favourite: Boolean = false, val orders: Int = 0,
    val boughtBefore: Boolean = false, val categories: List<SupplierCat> = emptyList(), val recentOrders: List<SupplierOrder> = emptyList(), val boughtMost: List<BoughtItem> = emptyList())
@Serializable data class PickItem(val id: String, val name: String, val unit: String = "", val picked: Boolean = false, val boughtBefore: Boolean = false, val times: Int = 0, val lastPrice: Double? = null)
@Serializable data class OrderSummary(val id: String, val number: Int, val status: String, val expectedDate: String? = null, val supplier: NamedRef, val items: Int = 0, val names: String? = null, val total: Double = 0.0)
@Serializable data class OrderSupplier(val id: String, val name: String, val phone: String? = null, val onWhatsapp: Boolean = true)
@Serializable data class OrderLine(val productId: String, val name: String, val unit: String = "", val hasExpiry: Boolean = false, val quantity: Int = 0, val received: Int = 0, val store: Int = 0, val unitPrice: Double? = null, val lastPrice: Double? = null)
@Serializable data class Order(val id: String, val number: Int, val status: String, val siteName: String = "", val supplier: OrderSupplier, val expectedDate: String? = null, val lines: List<OrderLine> = emptyList(), val total: Double = 0.0, val message: String = "")
@Serializable data class Suggestion(val productId: String, val name: String, val unit: String = "", val store: Int = 0, val par: Int = 0, val lastQuantity: Int? = null, val lastPrice: Double? = null, val quantity: Int = 0)
@Serializable data class LowItem(val productId: String, val name: String, val unit: String = "", val store: Int = 0, val min: Int = 0)
@Serializable data class UseFirstItem(val productId: String, val name: String, val unit: String = "", val quantity: Int = 0, val days: Int = 0)
@Serializable data class SiteHome(val isWarehouse: Boolean = false, val deliveriesDue: List<OrderSummary> = emptyList(), val drafts: List<OrderSummary> = emptyList(), val low: List<LowItem> = emptyList(), val useFirst: List<UseFirstItem> = emptyList())
@Serializable data class DraftMatch(val productId: String, val name: String, val unit: String = "", val lastPrice: Double? = null)
@Serializable data class DraftLine(val heard: String = "", val quantity: Int? = null, val match: DraftMatch? = null, val alternatives: List<DraftMatch> = emptyList(), val unsure: Boolean = false)
@Serializable data class OrderDraft(val text: String = "", val supplier: NamedRef? = null, val lines: List<DraftLine> = emptyList(), val total: Double = 0.0, val ready: Boolean = false)
@Serializable data class Flag(val productId: String = "", val kind: String = "", val detail: String = "")
@Serializable data class DeliveryResult(val deliveryId: String, val orderStatus: String? = null, val flags: List<Flag> = emptyList(), val creditDue: Double = 0.0)
@Serializable data class Created(val id: String, val number: Int? = null, val existed: Boolean = false)

// App state shapes
enum class Tab { TODAY, COUNT, STOCK, DELIVERIES, ACTIVITY, ATTEMPTS, SUPPLIERS, ORDERS }
/** One line of an order being written: what the store has, what would fill it up, what was ordered last time, and the quantity typed. */
data class FormLine(val productId: String, val name: String, val unit: String = "", val store: Int = 0, val fill: Int = 0, val last: Int? = null, val qty: Int = 0)
/** A screen opened on top of a tab (back returns to the tab). */
sealed class Page {
    data class SupplierCard(val supplier: Supplier) : Page()
    object SupplierAdd : Page()
    data class SupplierItems(val supplier: Supplier, val cat: SupplierCat, val items: List<PickItem>) : Page()
    data class OrderForm(val supplier: NamedRef?, val lines: List<FormLine> = emptyList(), val orderId: String? = null, val source: String = "FORM") : Page()
    data class Message(val order: Order) : Page()
    data class Check(val order: Order) : Page()
    object AddItem : Page()
}
data class Notice(val text: String, val warn: Boolean = true)
enum class Role { ME, APP }
sealed class ChatBody {
    data class Said(val text: String, val spoken: Boolean, val lang: String? = null) : ChatBody()
    data class Text(val text: String, val warn: Boolean) : ChatBody()
    data class Stock(val rows: List<QueryRow>) : ChatBody()
    data class Counted(val items: List<Pair<String, Int?>>) : ChatBody()
    data class Retry(val heard: String) : ChatBody()
    /** A spoken request to the warehouse, waiting for the manager to press Send. */
    data class Ask(val lines: List<Pair<Product, Int>>, var sent: Boolean = false) : ChatBody()
    /** An order to a supplier built from one spoken sentence. Nothing is ordered until Confirm. */
    data class Draft(val draft: OrderDraft, val state: String = "OPEN") : ChatBody()
}
data class ChatMessage(val role: Role, val body: ChatBody, val id: Long = System.nanoTime())

val EMOJI = mapOf("SOAP" to "🧼", "SHAMPOO" to "🧴", "COMB" to "🪮", "DENTAL_KIT" to "🦷", "TOOTHBRUSH" to "🪥", "TOOTHPASTE" to "🦷", "TISSUE" to "🧻", "COFFEE" to "☕")
fun Product.emoji() = icon?.takeIf { it.isNotBlank() } ?: EMOJI[sku] ?: "📦"
fun Product.native(lang: String): String? {
    if (lang == "en") return null
    val re = if (lang == "gu") Regex("[\\u0A80-\\u0AFF]") else Regex("[\\u0900-\\u097F]")
    return aliases.firstOrNull { re.containsMatchIn(it.alias) }?.alias
}
/** "2026-11-15T10:03:46.123Z" -> epoch millis, or null. */
fun String.isoMillis(): Long? = runCatching { java.time.Instant.parse(this).toEpochMilli() }.getOrNull()
fun String.hhmm(): String = isoMillis()?.let { java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date(it)) } ?: ""
