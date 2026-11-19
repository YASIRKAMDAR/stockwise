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

    // ---- Buying: suppliers, orders, deliveries ----
    private val dairy = Supplier(id = "s1", name = "Demo Dairy", phone = "98250 00001", favourite = true, orders = 12, boughtBefore = true,
        categories = listOf(SupplierCat("c1", "Food", allItems = false, picked = 4, orders = 12, boughtBefore = true)),
        recentOrders = listOf(SupplierOrder("o7", 7, "SENT", "Butter, Milk, Paneer", 9120.0, "2026-11-18T05:00:00Z"), SupplierOrder("o5", 5, "RECEIVED", "Curd, Paneer", 4300.0, "2026-11-12T05:00:00Z")),
        boughtMost = listOf(BoughtItem("i1", "Paneer", "KG", 11, 320.0), BoughtItem("i2", "Amul Butter 500 g", "PKT", 9, 285.0), BoughtItem("i3", "Milk full cream", "LTR", 8, 66.0)))
    private fun buying(): AppState {
        val s = state()
        s.hotelId = "wh"; s.alerts = emptyList(); s.corrections = emptyList(); s.requests = emptyList()
        s.categories = listOf(Category("c1", "Food & Beverage", "Food", 610), Category("c2", "Housekeeping", "Cleaning", 140), Category("c3", "Fruits & Vegetables", "Fruit & vegetables", 95), Category("c4", "Engineering", "Repairs & spares", 210))
        s.suppliers = listOf(dairy,
            Supplier("s2", "Demo Provisions", "98250 00002", orders = 8, boughtBefore = true, categories = listOf(SupplierCat("c1", "Food"), SupplierCat("c3", "Fruit & vegetables"))),
            Supplier("s3", "Demo Cleaning Supplies", "98250 00003", orders = 3, boughtBefore = true, categories = listOf(SupplierCat("c2", "Cleaning"))),
            Supplier("s4", "Patel Vegetables", "98250 00004", categories = listOf(SupplierCat("c3", "Fruit & vegetables"))),
            Supplier("s5", "Shree Hardware", null, categories = listOf(SupplierCat("c4", "Repairs & spares"))))
        s.home = SiteHome(isWarehouse = true,
            deliveriesDue = listOf(OrderSummary("o7", 7, "SENT", "2026-11-21", NamedRef("s1", "Demo Dairy"), 3, "Butter, Milk, Paneer", 9120.0)),
            drafts = listOf(OrderSummary("o8", 8, "DRAFT", null, NamedRef("s3", "Demo Cleaning Supplies"), 2, "Floor cleaner, Phenyl", 0.0)),
            low = listOf(LowItem("i1", "Paneer", "KG", 4, 10), LowItem("i5", "Basmati rice", "KG", 20, 50)),
            useFirst = listOf(UseFirstItem("i4", "Curd", "KG", 6, 2)))
        return s
    }
    private val order = Order("o7", 7, "DRAFT", "Central Warehouse", OrderSupplier("s1", "Demo Dairy", "98250 00001"), "2026-11-21",
        listOf(OrderLine("i1", "Paneer", "KG", true, 20, 0, 4, 320.0, 320.0), OrderLine("i2", "Amul Butter 500 g", "PKT", true, 24, 0, 6, 285.0, 285.0), OrderLine("i3", "Milk full cream", "LTR", true, 40, 0, 10, 66.0, 66.0)), 15880.0,
        "Hello, order from Central Warehouse:\n\n1. Amul Butter 500 g — 24 PKT\n2. Milk full cream — 40 LTR\n3. Paneer — 20 KG\n\nPlease deliver by Saturday 21 Nov.\nOrder 7. Thank you.")
    @Test fun m30_warehouse_feed() { shot("m30-warehouse-feed", buying()) }
    @Test fun m31_suppliers() { val s = buying(); s.tab = Tab.SUPPLIERS; shot("m31-suppliers", s) }
    @Test fun m32_supplier_card() { val s = buying(); s.tab = Tab.SUPPLIERS; s.page = Page.SupplierCard(dairy); shot("m32-supplier-card", s) }
    @Test fun m33_supplier_add() { val s = buying(); s.tab = Tab.SUPPLIERS; s.page = Page.SupplierAdd; shot("m33-supplier-add", s) }
    @Test fun m34_supplier_items() {
        val s = buying(); s.tab = Tab.SUPPLIERS
        s.page = Page.SupplierItems(dairy, dairy.categories[0], listOf(PickItem("i1", "Paneer", "KG", true, true, 11), PickItem("i2", "Amul Butter 500 g", "PKT", true, true, 9), PickItem("i3", "Milk full cream", "LTR", true, true, 8), PickItem("i4", "Curd", "KG", true), PickItem("i6", "Cheese slices", "PKT"), PickItem("i7", "Ghee 1 L", "BTL")))
        shot("m34-supplier-items", s)
    }
    @Test fun m35_order() {
        val s = buying(); s.tab = Tab.ORDERS
        s.page = Page.OrderForm(NamedRef("s1", "Demo Dairy"), listOf(FormLine("i1", "Paneer", "KG", 4, 20, 20, 20), FormLine("i2", "Amul Butter 500 g", "PKT", 6, 24, 24, 24), FormLine("i3", "Milk full cream", "LTR", 10, 40, 40, 100), FormLine("i4", "Curd", "KG", 6, 0, 10, 0)))
        shot("m35-order", s)
    }
    @Test fun m36_order_message() { val s = buying(); s.tab = Tab.ORDERS; s.page = Page.Message(order); shot("m36-order-message", s) }
    @Test fun m37_check_delivery() { val s = buying(); s.tab = Tab.ORDERS; s.page = Page.Check(order.copy(status = "SENT")); s.photos = listOf("BILL" to ByteArray(1))
        s.bill = BillRead(true, listOf(BillLine("i1", "Paneer", 18, 340.0), BillLine("i2", "Amul Butter 500 g", 24, 285.0)), listOf(BillExtra("Delivery charge", 1.0)), listOf("i3"))
        shot("m37-check-delivery", s) }
    private val thread = ChatThread("h1", "Demo Hotel 1", true, listOf(
        Msg("m1", "REQUEST", "Demo Hotel 1 asks the warehouse for: 100 Soap, 40 Comb\n“Running low before the weekend”", false, "2026-11-16T03:00:00Z", "r1", false, "Priya Shah", "OPEN"),
        Msg("m2", "TEXT", "Can it come before 4? Big check-in tonight.", false, "2026-11-16T03:02:00Z", null, false, "Priya Shah"),
        Msg("m3", "TEXT", "Yes, packing now.", false, "2026-11-16T03:05:00Z", null, true, "Ramesh"),
        Msg("m4", "DELIVERY", "Delivery from Demo Dairy added to stock.\n• 2 Paneer still to come\n• Paneer billed at 340, order said 320", true, "2026-11-16T04:10:00Z", "d1", false, "Ramesh")))
    @Test fun m42_inbox() {
        val s = buying(); s.tab = Tab.INBOX
        s.inbox = Inbox(3, listOf(ThreadRow("h1", "Demo Hotel 1", "HOTEL", 2, LastMsg("Can it come before 4? Big check-in tonight.", "TEXT", false, "2026-11-16T03:02:00Z", "Priya Shah")),
            ThreadRow("wh", "Central Warehouse", "WAREHOUSE", 1, LastMsg("Delivery from Demo Dairy added to stock.", "DELIVERY", true, "2026-11-16T04:10:00Z", "Ramesh")),
            ThreadRow("h2", "Demo Hotel 2", "HOTEL", 0, LastMsg("The warehouse sent it (T-121).", "REQUEST_SENT", false, "2026-11-15T09:00:00Z", "Ramesh")), ThreadRow("h3", "Demo Hotel 3")))
        shot("m42-inbox", s)
    }
    @Test fun m43_team_chat() { val s = buying(); s.tab = Tab.INBOX; s.page = Page.Chat(thread); shot("m43-team-chat", s) }
    @Test fun m41_add_item() {
        val s = buying(); s.tab = Tab.STOCK; s.page = Page.AddItem
        s.webOptions = listOf(WebOption("Amul Cheese Slices 200 g", "Amul", "200 g", "PKT", 145.0), WebOption("Amul Processed Cheese Block 1 kg", "Amul", "1 kg", "KG", 560.0), WebOption("Amul Cheese Cubes 200 g", "Amul", "200 g", "PKT", 135.0))
        shot("m41-add-item", s)
    }
    @Test fun m38_orders() { val s = buying(); s.tab = Tab.ORDERS; shot("m38-orders", s) }
    @Test fun m39_warehouse_stock() {
        val s = buying(); s.tab = Tab.STOCK
        s.items = listOf(CatalogItem("i1", "F001", "Paneer", "KG", store = 4, min = 10, par = 24, status = "LOW", supplier = SupplierTag("s1", "Demo Dairy", 1)),
            CatalogItem("i4", "F004", "Curd", "KG", store = 6, status = "USE_FIRST", useFirst = UseFirst("2026-11-22", 6), supplier = SupplierTag("s1", "Demo Dairy")),
            CatalogItem("i2", "F002", "Amul Butter 500 g", "PKT", store = 30, status = "OK", supplier = SupplierTag("s1", "Demo Dairy")),
            CatalogItem("i5", "F005", "Basmati rice", "KG", store = 120, status = "OK", supplier = SupplierTag("s2", "Demo Provisions", 2)),
            CatalogItem("i8", "H001", "Floor cleaner 5 L", "CAN", store = 14, status = "OK", supplier = SupplierTag("s3", "Demo Cleaning Supplies")))
        shot("m39-warehouse-stock", s)
    }
    @Test fun m40_spoken_order() {
        val s = buying()
        val m = { id: String, name: String, unit: String -> DraftMatch(id, name, unit, 100.0) }
        s.chat = listOf(ChatMessage(Role.ME, ChatBody.Said("Demo Dairy ko order karo, 20 kilo paneer, 24 butter aur dahi", true, "mixed")),
            ChatMessage(Role.APP, ChatBody.Draft(OrderDraft("", NamedRef("s1", "Demo Dairy"), listOf(DraftLine("paneer", 20, m("i1", "Paneer", "KG")), DraftLine("butter", 24, m("i2", "Amul Butter 500 g", "PKT")), DraftLine("dahi", null, m("i4", "Curd", "KG"), unsure = true)), 0.0, false))))
        shot("m40-spoken-order", s)
    }
}
