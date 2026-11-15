package app.stockwise.manager

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.stockwise.manager.ui.Mic
import app.stockwise.manager.ui.ManagerApp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Renders the manager screens with sample data so they can be reviewed without a phone. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class ScreensTest {
    @get:Rule val rule = createComposeRule()

    private val mic = object : Mic {
        override val available = true
        override fun hasPermission() = true
        override fun requestPermission() {}
        override fun start(lang: String, record: Boolean, onInterim: (String) -> Unit, onLevel: (Float) -> Unit, onDone: (String?, Int?) -> Unit) { onInterim("How much shampoo"); onLevel(0.7f) }
        override fun hasVoice(lang: String) = true
        override val online = true
        override fun takeRecording(): ByteArray? = null
        override fun release() {}
        override fun cancel() {}
        override fun say(text: String, lang: String) {}
    }

    private fun state(): AppState {
        val s = AppState(ApplicationProvider.getApplicationContext())
        s.booting = false
        s.lang = "en"
        s.me = Me("u1", "Priya Shah", "M1", "MANAGER", "en", listOf(Hotel("wh", "Central Warehouse", "WH", kind = "WAREHOUSE"), Hotel("h1", "Demo Hotel 1", "H1"), Hotel("h2", "Demo Hotel 2", "H2"), Hotel("h3", "Demo Hotel 3", "H3")), MeConfig("fake", 25), warehouseId = "wh")
        s.hotelId = "h1"
        fun p(id: String, sku: String, name: String, gu: String, icon: String) = Product(id, sku, name, "pcs", icon, aliases = listOf(Alias("gu", gu)))
        s.products = listOf(p("p1", "SOAP", "Soap", "સાબુ", "🧼"), p("p2", "SHAMPOO", "Shampoo", "શેમ્પૂ", "🧴"), p("p3", "COMB", "Comb", "કાંસકો", "🪮"),
            p("p4", "TOOTHBRUSH", "Toothbrush", "બ્રશ", "🪥"), p("p5", "TISSUE", "Tissue box", "ટિશ્યૂ", "🧻"), p("p6", "COFFEE", "Coffee sachet", "કૉફી", "☕"))
        fun r(id: String, name: String, store: Int, th: Int, staff: Int) = StockRow(id, name, store = store, staffHeld = staff, reorderThreshold = th, low = th > 0 && store < th, out = store == 0)
        s.stock = listOf(r("p1", "Soap", 0, 24, 14), r("p2", "Shampoo", 86, 30, 6), r("p3", "Comb", 18, 20, 4), r("p4", "Toothbrush", 142, 40, 0), r("p5", "Tissue box", 60, 20, 2), r("p6", "Coffee sachet", 310, 100, 0))
        s.alerts = listOf(
            Alert("a1", "HIGH", "LOW_STOCK", "h1", "Soap out of stock at Demo Hotel 1", "Store 0 pcs, reorder at 24"),
            Alert("a2", "MEDIUM", "TRANSFER_DISCREPANCY", "h1", "Transfer T-118 Demo Hotel 2 → Demo Hotel 1", "12 units not received after 26h"),
            Alert("a3", "MEDIUM", "COUNT_OVERDUE", "h1", "Weekly count overdue at Demo Hotel 1", "Last count 9 days ago"))
        s.corrections = listOf(CorrectionRequest("c1", "e1", "Room 204 was 2 soap, not 12", "2026-11-15T11:50:00Z", "Staff 103"))
        s.countStatus = CountStatus("h1", "OVERDUE", "2026-11-06T09:00:00Z")
        s.requests = listOf(
            StockRequest("r1", "OPEN", "Running low before the weekend", "2026-11-16T03:00:00Z", null, null, NamedRef("h1", "Demo Hotel 1"), NamedRef("wh", "Central Warehouse"), "Priya Shah", listOf(RequestLine("p1", "Soap", "pcs", 100, 900), RequestLine("p3", "Comb", "pcs", 40, 20)), 2.0),
            StockRequest("r2", "SENT", null, "2026-11-15T07:00:00Z", "t5", "T5", NamedRef("h1", "Demo Hotel 1"), NamedRef("wh", "Central Warehouse"), "Scheduled", listOf(RequestLine("p2", "Shampoo", "pcs", 80, 470)), 22.0),
            StockRequest("r3", "OPEN", null, "2026-11-16T01:00:00Z", null, null, NamedRef("h2", "Demo Hotel 2"), NamedRef("wh", "Central Warehouse"), "Demo Manager 2", listOf(RequestLine("p2", "Shampoo", "pcs", 60, 470)), 4.0))
        s.schedules = listOf(RequestSchedule("s1", NamedRef("h1", "Demo Hotel 1"), 1, 7))
        s.transfers = listOf(
            Transfer("t1", "T-118", "DISCREPANCY", "2026-11-13T14:20:00Z", null, NamedRef("h2", "Demo Hotel 2"), NamedRef("h1", "Demo Hotel 1"), lines = listOf(TransferLine("p2", "Shampoo", sent = 40, received = 28)), outstandingUnits = 12, ageHours = 26.0, aged = true),
            Transfer("t2", "T-121", "OPEN", "2026-11-14T09:05:00Z", null, NamedRef("h1", "Demo Hotel 1"), NamedRef("h3", "Demo Hotel 3"), lines = listOf(TransferLine("p1", "Soap", sent = 50)), outstandingUnits = 50, ageHours = 31.0, aged = true))
        s.recentTransfers = listOf(Transfer("t3", "T-116", "RECEIVED", "2026-11-11T10:00:00Z", null, NamedRef("h3", "Demo Hotel 3"), NamedRef("h1", "Demo Hotel 1"), lines = listOf(TransferLine("p3", "Comb", sent = 30, received = 30))))
        val today = java.time.Instant.now().toString()
        s.events = listOf(
            Event("e1", "PLACE_IN_ROOM", today, actor = Who("Staff 103", "S103"), viaVoice = true, lines = listOf(EventLine("p1", "Soap", 12, "204"))),
            Event("e2", "CHECKOUT_TO_STAFF", today, actor = Who("Staff 101", "S101"), viaVoice = true, lines = listOf(EventLine("p3", "Comb", 10))),
            Event("e3", "RETURN_TO_STORE", today, actor = Who("Staff 101", "S101"), lines = listOf(EventLine("p3", "Comb", 5))),
            Event("e4", "TRANSFER_RECEIPT", today, actor = Who("Priya Shah", "M1"), lines = listOf(EventLine("p2", "Shampoo", 28))))
        return s
    }
    private fun sheet(): CountSheet {
        fun l(id: String, name: String, icon: String, exp: Int, got: Int?) = CountLine(id, name, icon, "pcs", exp, got, variance = got?.minus(exp))
        return CountSheet("c1", "DRAFT", "2026-11-15T10:04:00Z", listOf(l("p1", "Soap", "🧼", 0, 0), l("p2", "Shampoo", "🧴", 86, 80), l("p3", "Comb", "🪮", 18, 18), l("p4", "Toothbrush", "🪥", 142, 142), l("p5", "Tissue box", "🧻", 60, null), l("p6", "Coffee sachet", "☕", 310, null)))
    }
    private fun shot(name: String, s: AppState, drawer: Boolean = false) {
        rule.setContent { ManagerApp(s, mic, drawer) }
        rule.onRoot().captureRoboImage("build/screens/$name.png")
    }

    @Test fun m01_login() { val s = state(); s.me = null; shot("m01-sign-in", s) }
    @Test fun m02_today() { shot("m02-today", state()) }
    @Test fun m03_ask() {
        val s = state()
        s.chat = listOf(ChatMessage(Role.ME, ChatBody.Said("Soap kitna bacha hai?", true, "hi")), ChatMessage(Role.APP, ChatBody.Stock(listOf(QueryRow("p1", "Soap", "pcs", 0, 14, 0, "Demo Hotel 1", true)))),
            ChatMessage(Role.ME, ChatBody.Said("Aaje combs kone lidha?", true, "mixed")), ChatMessage(Role.APP, ChatBody.Stock(listOf(QueryRow("p3", "Comb", "pcs", 18, 4, 0, "Demo Hotel 1", true)))))
        shot("m03-ask", s)
    }
    @Test fun m04_count() { val s = state(); s.tab = Tab.COUNT; s.sheet = sheet(); s.chat = listOf(ChatMessage(Role.ME, ChatBody.Said("Toothbrush ek so bayalis, comb athar", true, "mixed")), ChatMessage(Role.APP, ChatBody.Counted(listOf("Toothbrush" to 142, "Comb" to 18)))); shot("m04-count", s) }
    @Test fun m05_count_start() { val s = state(); s.tab = Tab.COUNT; shot("m05-count-start", s) }
    @Test fun m06_deliveries() { val s = state(); s.tab = Tab.DELIVERIES; shot("m06-deliveries", s) }
    @Test fun m07_activity() { val s = state(); s.tab = Tab.ACTIVITY; shot("m07-activity", s) }
    @Test fun m08_menu() { shot("m08-menu", state(), drawer = true) }
    @Test fun m09_stock() { val s = state(); s.tab = Tab.STOCK; shot("m09-stock", s) }
    @Test fun m10_gujarati() { val s = state(); s.lang = "gu"; shot("m10-today-gujarati", s) }
    @Test fun m11_intro() { val s = state(); s.showIntro = true; shot("m11-intro", s) }

    @Test fun m20_today_hotel_requests() { shot("m20-today-from-warehouse", state()) }
    @Test fun m21_warehouse_today() { val s = state(); s.hotelId = "wh"; s.alerts = emptyList(); s.corrections = emptyList(); s.stock = s.stock.map { it.copy(store = it.store * 10 + 300, low = false, out = false) }; shot("m21-warehouse-today", s) }
    @Test fun m22_warehouse_deliveries() { val s = state(); s.hotelId = "wh"; s.tab = Tab.DELIVERIES; s.transfers = emptyList(); shot("m22-warehouse-deliveries", s) }
    @Test fun m23_hotel_deliveries() { val s = state(); s.tab = Tab.DELIVERIES; shot("m23-hotel-deliveries", s) }
    @Test fun m24_ask_card() {
        val s = state()
        s.chat = listOf(ChatMessage(Role.ME, ChatBody.Said("warehouse se 50 sabun mangwao", true, "hi")), ChatMessage(Role.APP, ChatBody.Ask(listOf(s.products[0] to 50))))
        shot("m24-ask-card", s)
    }
}
