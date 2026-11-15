package app.stockwise.staff

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable data class Hotel(val id: String, val name: String, val code: String = "", val timezone: String = "Asia/Kolkata", val allowStoreToRoom: Boolean = true, val roles: List<String> = emptyList())
@Serializable data class MeConfig(val voiceProvider: String = "disabled", val voiceMaxSeconds: Int = 25)
@Serializable data class Me(
    val id: String, val displayName: String, val employeeCode: String = "", val role: String = "STAFF", val authMethod: String = "PIN",
    val language: String = "en", val hotels: List<Hotel> = emptyList(), val activeHotel: String? = null, val config: MeConfig = MeConfig(),
)
@Serializable data class Alias(val locale: String, val alias: String)
@Serializable data class Product(val id: String, val sku: String, val name: String, val unit: String = "", val icon: String? = null, val active: Boolean = true, val aliases: List<Alias> = emptyList())
@Serializable data class Room(val id: String, val roomNumber: String, val active: Boolean = true)
@Serializable data class BagItem(val productId: String, val name: String, val quantity: Int)
@Serializable data class BagResponse(val items: List<BagItem> = emptyList())
@Serializable data class StoreRow(val productId: String, val name: String, val store: Int = 0, val staffHeld: Int = 0, val low: Boolean = false)
@Serializable data class StoreResponse(val items: List<StoreRow> = emptyList())
@Serializable data class DeviceCred(val deviceId: String, val deviceSecret: String, val hotelId: String, val label: String)

@Serializable data class ProposalLine(
    val productId: String? = null, val productName: String? = null, val spokenProduct: String = "", val quantity: Int? = null,
    val roomId: String? = null, val roomNumber: String? = null, val source: String? = null, val issues: List<String> = emptyList(),
)
@Serializable data class QueryRow(val productId: String, val name: String, val store: Int = 0, val staffHeld: Int = 0, val hotelName: String = "")
@Serializable data class Proposal(
    val proposalId: String, val status: String, val transcript: String = "", val action: String,
    val lines: List<ProposalLine> = emptyList(), val queryResult: List<QueryRow>? = null, val clarificationQuestion: String? = null,
    val detectedLanguage: String? = null,
    val warnings: List<String> = emptyList(),
)
@Serializable data class EventLine(val productId: String? = null, val name: String = "", val quantity: Int = 0, val roomNumber: String? = null)
@Serializable data class Event(val eventId: String, val action: String, val createdAt: String, val viaVoice: Boolean = false, val reversedBy: String? = null, val lines: List<EventLine>? = null)
@Serializable data class ActivityPage(val items: List<Event> = emptyList())
/** One of the staff member's own recent voice attempts, as the server logged it (never audio). */
@Serializable data class VoiceAttempt(val createdAt: String, val status: String, val errorCode: String? = null, val language: String? = null, val client: String? = null,
    val inputKind: String? = null, val fallback: String? = null, val latencyMs: Int? = null, val transcript: String? = null, val action: String? = null, val confirmed: Boolean? = null)
@Serializable data class VoiceAttemptsPage(val attempts: List<VoiceAttempt> = emptyList())
@Serializable data class TxResult(val eventId: String = "", val refCode: String? = null)
@Serializable data class ApiErrorBody(val error: ApiErrorInner? = null)
@Serializable data class ApiErrorInner(val code: String = "", val message: String = "", val details: JsonElement? = null)

/** The jobs a housekeeping phone records. */
enum class Kind(val api: String, val needsRoom: Boolean) {
    PLACE_IN_ROOM("PLACE_IN_ROOM", true), CHECKOUT_TO_STAFF("CHECKOUT_TO_STAFF", false),
    RETURN_TO_STORE("RETURN_TO_STORE", false), SUPPLIER_RECEIPT("SUPPLIER_RECEIPT", false);
    companion object { fun of(api: String) = entries.firstOrNull { it.api == api } }
}

/** One line on the check screen. source: STORE | MY_STOCK (only for PLACE_IN_ROOM). */
data class Line(val productId: String?, val quantity: Int, val roomId: String? = null, val roomNumber: String? = null, val source: String? = null, val spoken: String = "", val issues: List<String> = emptyList())

val EMOJI = mapOf("SOAP" to "🧼", "SHAMPOO" to "🧴", "COMB" to "🪮", "DENTAL_KIT" to "🦷", "TOOTHBRUSH" to "🪥", "TOOTHPASTE" to "🦷")
fun Product.emoji() = icon?.takeIf { it.isNotBlank() } ?: EMOJI[sku] ?: "📦"
fun Product.native(lang: String): String? {
    if (lang == "en") return null
    val re = if (lang == "gu") Regex("[\\u0A80-\\u0AFF]") else Regex("[\\u0900-\\u097F]")
    return aliases.firstOrNull { re.containsMatchIn(it.alias) }?.alias
}
