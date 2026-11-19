package app.stockwise.manager

import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.stockwise.manager.ui.ManagerApp
import app.stockwise.manager.ui.Mic
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The manager app driven end to end against a fake Stockwise server: sign in, ask the store a question,
 * start the weekly count and read counts out (as typed text, the same server path as speech), receive a delivery.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class EndToEndTest {
    @get:Rule val rule = createComposeRule()
    private lateinit var server: MockWebServer
    private val received = mutableListOf<RecordedRequest>()
    private var sheetLines = """[{"productId":"p1","name":"Soap","expectedQty":50,"physicalQty":null},{"productId":"p2","name":"Shampoo","expectedQty":30,"physicalQty":null}]"""

    private val mic = object : Mic {
        override val available = false
        override fun hasPermission() = true
        override fun requestPermission() {}
        override fun start(lang: String, record: Boolean, onInterim: (String) -> Unit, onLevel: (Float) -> Unit, onDone: (String?, Int?) -> Unit) { onDone(null, null) }
        override fun hasVoice(lang: String) = true
        override val online = true
        override fun takeRecording(): ByteArray? = null
        override fun release() {}
        override fun cancel() {}
        override fun say(text: String, lang: String) {}
    }

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("content-type", "application/json").setBody(body.trimIndent())

    private var requestsJson = "[]"
    private val openRequest = """[{"id":"r1","status":"OPEN","note":"low","createdAt":"2026-11-16T03:00:00Z","hotel":{"id":"h1","name":"Demo Hotel 1"},"warehouse":{"id":"wh","name":"Central Warehouse"},"requestedBy":"Priya Shah",
        "lines":[{"productId":"p1","name":"Soap","unit":"pcs","quantity":48,"warehouseStock":900}],"ageHours":2.0}]"""
    // Buying from a supplier: one order that moves DRAFT -> SENT -> RECEIVED.
    private var orderStatus = "NONE"
    private fun orderJson() = """{"id":"o1","number":7,"status":"$orderStatus","siteName":"Central Warehouse","supplier":{"id":"s1","name":"Demo Dairy","phone":"98250 00001","onWhatsapp":true},
        "lines":[{"productId":"i1","name":"Paneer","unit":"KG","hasExpiry":true,"quantity":20,"received":0,"store":4,"unitPrice":320.0,"lastPrice":320.0}],"total":6400.0,
        "message":"Hello, order from Central Warehouse:\n\n1. Paneer — 20 KG\n\nOrder 7. Thank you."}"""
    private val orderRow = """{"id":"o1","number":7,"status":"SENT","supplier":{"id":"s1","name":"Demo Dairy"},"items":1,"names":"Paneer","total":6400.0}"""
    private val supplierJson = """{"id":"s1","name":"Demo Dairy","phone":"98250 00001","onWhatsapp":true,"deliveryDays":1,"favourite":false,"orders":3,"boughtBefore":true,
        "categories":[{"id":"c1","name":"Food","allItems":true,"picked":0,"orders":3,"boughtBefore":true}],"recentOrders":[],"boughtMost":[]}"""
    @Before fun startServer() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                received += request
                val p = request.path ?: ""
                val body = if (request.method != "GET") request.body.clone().readUtf8() else ""
                return when {
                    p.endsWith("/auth/login") && request.method == "POST" -> json("""{"ok":true}""").addHeader("Set-Cookie", "sw_session=mgr; Path=/; HttpOnly")
                    p.endsWith("/me") && request.method == "GET" -> json("""{"id":"m1","displayName":"Priya Shah","employeeCode":"M1","role":"MANAGER","language":"en",
                        "hotels":[{"id":"wh","name":"Central Warehouse","code":"WH","kind":"WAREHOUSE","roles":["MANAGER"]},{"id":"h1","name":"Demo Hotel 1","code":"H1","roles":["MANAGER"]},{"id":"h2","name":"Demo Hotel 2","code":"H2","roles":["MANAGER"]}],"warehouseId":"wh","config":{"voiceProvider":"fake"}}""")
                    p.contains("/hotels/wh/stock") -> json("""{"items":[{"productId":"p1","name":"Soap","store":900,"reorderThreshold":200},{"productId":"p2","name":"Shampoo","store":470,"reorderThreshold":100}]}""")
                    p.startsWith("/requests/top-up") -> json("""{"warehouse":{"id":"wh","name":"Central Warehouse"},"lines":[{"productId":"p1","name":"Soap","par":48,"store":0,"onTheWay":0,"requested":0,"warehouse":900,"quantity":48},{"productId":"p2","name":"Shampoo","par":60,"store":86,"onTheWay":0,"requested":0,"warehouse":470,"quantity":0}]}""")
                    p.endsWith("/requests") && request.method == "POST" -> { requestsJson = openRequest; json("""{"requestId":"r1","status":"OPEN"}""", 201) }
                    p.startsWith("/requests?") -> json(requestsJson)
                    p.endsWith("/requests/r1/dispatch") && request.method == "POST" -> { requestsJson = "[]"; json("""{"transferId":"t9","refCode":"T9","status":"IN_TRANSIT"}""", 201) }
                    p.startsWith("/request-schedules") -> json("[]")
                    p.endsWith("/products") -> json("""[{"id":"p1","sku":"SOAP","name":"Soap","unit":"pcs","icon":"🧼"},{"id":"p2","sku":"SHAMPOO","name":"Shampoo","unit":"pcs","icon":"🧴"}]""")
                    p.contains("/hotels/h1/stock") -> json("""{"items":[{"productId":"p1","name":"Soap","store":0,"staffHeld":14,"reorderThreshold":24,"low":true,"out":true},{"productId":"p2","name":"Shampoo","store":86,"reorderThreshold":30}]}""")
                    p.startsWith("/dashboard/alerts") -> json("""{"items":[{"id":"a1","severity":"HIGH","category":"LOW_STOCK","hotelId":"h1","title":"Soap out of stock at Demo Hotel 1","detail":"Store 0 pcs, reorder at 24"}]}""")
                    p.startsWith("/correction-requests") -> json("[]")
                    p.startsWith("/counts/status") -> json("""[{"hotelId":"h1","state":"OVERDUE","lastSubmittedAt":"2026-11-06T09:00:00Z","draftCountId":null}]""")
                    p.endsWith("/counts") && request.method == "POST" -> json("""{"id":"c1","status":"DRAFT","lines":$sheetLines}""", 201)
                    p.startsWith("/counts?") -> json("[]")
                    p.endsWith("/counts/c1/lines") && request.method == "PATCH" -> {
                        sheetLines = """[{"productId":"p1","name":"Soap","expectedQty":50,"physicalQty":48,"variance":-2},{"productId":"p2","name":"Shampoo","expectedQty":30,"physicalQty":30,"variance":0}]"""
                        json("""{"id":"c1","status":"DRAFT","lines":$sheetLines}""")
                    }
                    p.endsWith("/voice/interpret") -> {
                        if (body.contains("name=\"mode\"") && body.contains("count"))
                            json("""{"proposalId":"pc","status":"COUNT_ENTRY","action":"COUNT_ENTRY","transcript":"soap 48, shampoo 30","detectedLanguage":"en-IN",
                                "lines":[{"productId":"p1","productName":"Soap","spokenProduct":"soap","quantity":48,"issues":[]},{"productId":"p2","productName":"Shampoo","spokenProduct":"shampoo","quantity":30,"issues":[]}],"warnings":[]}""")
                        else if (body.contains("warehouse se"))
                            json("""{"proposalId":"pr","status":"READY_TO_CONFIRM","action":"REQUEST_FROM_WAREHOUSE","transcript":"warehouse se 48 sabun mangwao","detectedLanguage":"hi-IN",
                                "lines":[{"productId":"p1","productName":"Soap","spokenProduct":"sabun","quantity":48,"issues":[]}],"warnings":[]}""")
                        else
                            json("""{"proposalId":"pq","status":"QUERY_RESULT","action":"STOCK_QUERY","transcript":"Soap kitna bacha hai?","detectedLanguage":"hi-IN","lines":[],"warnings":[],
                                "queryResult":[{"productId":"p1","name":"Soap","unit":"pcs","store":0,"staffHeld":14,"inTransit":0,"hotelName":"Demo Hotel 1","low":true}]}""")
                    }
                    p.startsWith("/transfers?") -> json("""[{"id":"t1","refCode":"T-118","status":"OPEN","dispatchedAt":"2026-11-14T09:05:00Z","fromHotel":{"id":"h2","name":"Demo Hotel 2"},"toHotel":{"id":"h1","name":"Demo Hotel 1"},
                        "lines":[{"productId":"p2","name":"Shampoo","sent":40,"received":0,"resolvedShort":0}],"outstandingUnits":40,"ageHours":5.0,"aged":false}]""")
                    p.endsWith("/transfers/t1/receipts") && request.method == "POST" -> json("""{"ok":true}""", 201)
                    p.startsWith("/transactions") -> json("""{"items":[]}""")
                    p.startsWith("/me/voice-attempts") -> json("""{"attempts":[]}""")
                    p.startsWith("/sites/") -> json("""{"isWarehouse":true,"deliveriesDue":[${if (orderStatus == "SENT") orderRow else ""}],"drafts":[],"low":[],"useFirst":[]}""")
                    p.startsWith("/catalog/categories") -> json("""[{"id":"c1","name":"Food & Beverage","shortName":"Food","items":3}]""")
                    p == "/suppliers/s1" -> json(supplierJson)
                    p.startsWith("/suppliers") -> json("[$supplierJson]")
                    p.startsWith("/orders/suggest") -> json("""[{"productId":"i1","name":"Paneer","unit":"KG","store":4,"par":24,"lastQuantity":20,"lastPrice":320.0,"quantity":20}]""")
                    p == "/orders/draft-from-text" -> json("""{"text":"order from demo dairy 20 kilo paneer","supplier":{"id":"s1","name":"Demo Dairy"},
                        "lines":[{"heard":"paneer","quantity":20,"match":{"productId":"i1","name":"Paneer","unit":"KG","lastPrice":320.0},"alternatives":[],"unsure":false}],"total":6400.0,"ready":true}""")
                    p == "/orders" && request.method == "POST" -> { orderStatus = "DRAFT"; json("""{"id":"o1","number":7,"status":"DRAFT"}""", 201) }
                    p == "/orders/o1/send" -> { orderStatus = "SENT"; json(orderJson()) }
                    p == "/orders/o1/deliveries" -> { orderStatus = "RECEIVED"; json("""{"deliveryId":"d1","orderStatus":"RECEIVED","flags":[],"creditDue":0.0}""", 201) }
                    p == "/orders/o1" -> json(orderJson())
                    else -> json("""{"error":{"code":"NOT_FOUND","message":"no route $p"}}""", 404)
                }
            }
        }
        server.start()
    }
    @After fun stopServer() { server.shutdown() }
    /** The value of one multipart field (parts carry a Content-Length line before the blank line). */
    private fun part(form: String, name: String): String? = Regex("name=\"" + name + "\"[\\s\\S]*?\\r\\n\\r\\n([^\\r]*)").find(form)?.groupValues?.get(1)
    private fun pump() { org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle(); rule.waitForIdle() }

    /** Waits for a condition while pumping the main looper (coroutines on Dispatchers.Main and OkHttp callbacks land there), with a readable failure. */
    private fun waitFor(s: AppState, what: String, timeout: Long = 10_000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + timeout
        while (!cond()) {
            if (System.currentTimeMillis() > end) throw AssertionError("Timed out waiting for $what. loginError=${s.loginError} notice=${s.notice} busy=${s.busy} chat=${s.chat.size} requests=${received.map { "${it.method} ${it.path}" }}")
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            rule.waitForIdle()
            Thread.sleep(25)
        }
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        rule.waitForIdle()
    }

    private fun state() = AppState(ApplicationProvider.getApplicationContext(), server.url("/").toString().trimEnd('/')).also { it.booting = false; it.lang = "en"; it.store.introSeen = true; it.store.hotelId = "h1"; it.hotelId = "h1" }

    private fun signIn(s: AppState) {
        rule.setContent { ManagerApp(s, mic) }
        rule.onAllNodes(hasSetTextAction())[0].performTextInput("M1")
        rule.onAllNodes(hasSetTextAction())[1].performTextInput("secret-pass")
        rule.onNode(hasText("Sign in") and hasClickAction()).performClick(); pump()
        waitFor(s, "s.me != null && s.stock.isNotEmpty()", 10_000) { s.me != null && s.stock.isNotEmpty() && !s.busy }
        rule.waitForIdle()
    }

    @Test fun today_ask_count_receive() {
        val s = state()
        signIn(s)
        // Today: the alert and the store cards.
        rule.onNodeWithText("Soap out of stock at Demo Hotel 1").assertExists()
        rule.onNodeWithText("1 thing needs you").assertExists()

        // Ask by text (same server path as speech): the answer appears in the thread, nothing is written.
        rule.onNodeWithContentDescription("Ask: “how much soap is left?”").performTextInput("soap kitna bacha hai")
        rule.onNodeWithContentDescription("Send").performClick(); pump()
        waitFor(s, "stock answer", 10_000) { s.chat.any { it.body is ChatBody.Stock } && !s.busy }
        rule.waitForIdle()
        rule.onNodeWithText("soap kitna bacha hai").assertExists()
        rule.onNodeWithText("हिंदी").assertExists()
        rule.onNodeWithText("14 with staff").assertExists()
        val interpret = received.last { it.path?.endsWith("/voice/interpret") == true }
        val form = interpret.body.readUtf8()
        assertEquals("all", part(form, "scope")); assertEquals("android-manager", part(form, "client")); assertEquals(null, part(form, "mode"))

        // Weekly count: start it, read two counts out, see the boxes fill and the sheet patched on the server.
        s.clearChat()
        s.go(Tab.COUNT)
        waitFor(s, "s.countStatus != null", 10_000) { s.countStatus != null }
        rule.waitForIdle()
        rule.onNodeWithText("Weekly count overdue").assertExists()
        rule.onNodeWithText("Start count").performClick(); pump()
        waitFor(s, "s.sheet != null", 10_000) { s.sheet != null && !s.busy }
        rule.waitForIdle()
        rule.onNodeWithText("0 of 2 counted").assertExists()
        rule.onNodeWithContentDescription("Say: “soap forty-eight”").performTextInput("soap 48, shampoo 30")
        rule.onNodeWithContentDescription("Send").performClick(); pump()
        waitFor(s, "s.sheet?.lines?.all { it.physicalQty != null } == true", 10_000) { s.sheet?.lines?.all { it.physicalQty != null } == true }
        waitFor(s, "received.any { it.path == '/counts/c1/lines' && it.method == 'PATCH' }", 10_000) { received.any { it.path == "/counts/c1/lines" && it.method == "PATCH" } }
        rule.waitForIdle()
        rule.onNodeWithText("Heard 2 items").assertExists()
        rule.onAllNodesWithText("48")[0].assertExists()
        rule.onNodeWithText("2 of 2 counted").assertExists()
        rule.onNodeWithText("Differs from the book — why?").assertExists()      // soap 48 vs book 50
        val countForm = received.last { it.path?.endsWith("/voice/interpret") == true }.body.readUtf8()
        assertEquals("count", part(countForm, "mode"))

        // Deliveries: "All arrived" posts a final receipt for the outstanding quantity.
        s.clearChat()
        s.go(Tab.DELIVERIES)
        waitFor(s, "s.transfers.isNotEmpty()", 10_000) { s.transfers.isNotEmpty() }
        rule.waitForIdle()
        rule.onNodeWithText("All arrived").performClick(); pump()
        waitFor(s, "received.any { it.path == '/transfers/t1/receipts' }", 10_000) { received.any { it.path == "/transfers/t1/receipts" } }
        val receipt = received.last { it.path == "/transfers/t1/receipts" }
        assertEquals("POST", receipt.method)
        assertTrue(receipt.getHeader("idempotency-key") != null)
        val rb = receipt.body.readUtf8()
        assertTrue(rb, rb.contains("\"productId\":\"p2\"") && rb.contains("\"receivedQuantity\":40") && rb.contains("\"final\":true"))
    }

    @Test fun hotel_asks_warehouse_sends() {
        val s = state()
        signIn(s)
        // Hotel side: the low-stock alert, and "Ask warehouse" opens the request sheet pre-filled to par.
        rule.onNodeWithText("From the warehouse").assertExists()
        rule.onNodeWithText("Ask warehouse").performClick(); pump()
        waitFor(s, "top-up loaded", 10_000) { s.topUp != null }
        rule.waitForIdle()
        rule.onNodeWithText("Send request").performClick(); pump()
        waitFor(s, "request posted", 10_000) { received.any { it.path == "/requests" && it.method == "POST" } }
        val ask = received.last { it.path == "/requests" && it.method == "POST" }.body.readUtf8()
        assertTrue(ask, ask.contains("\"hotelId\":\"h1\"") && ask.contains("\"productId\":\"p1\"") && ask.contains("\"quantity\":48") && !ask.contains("\"productId\":\"p2\""))
        waitFor(s, "request listed", 10_000) { s.openRequests.isNotEmpty() }
        rule.waitForIdle()
        rule.onNodeWithText("Waiting for the warehouse · Asked 2 h ago").assertExists()

        // Spoken request: a card waits for Send; nothing is posted until then.
        requestsJson = "[]"; received.clear()
        rule.onNodeWithContentDescription("Ask: “how much soap is left?”").performTextInput("warehouse se 48 sabun mangwao")
        rule.onNodeWithContentDescription("Send").performClick(); pump()
        waitFor(s, "ask card", 10_000) { s.chat.any { it.body is ChatBody.Ask } && !s.busy }
        rule.waitForIdle()
        assertTrue(received.none { it.path == "/requests" && it.method == "POST" })
        rule.onNodeWithText("Send request").performClick(); pump()
        waitFor(s, "spoken request posted", 10_000) { received.any { it.path == "/requests" && it.method == "POST" } }
        waitFor(s, "card marked sent", 10_000) { s.chat.any { (it.body as? ChatBody.Ask)?.sent == true } }

        // Warehouse side: switch site, see the request, send it all.
        s.clearChat(); received.clear()
        s.setHotel("wh")
        waitFor(s, "warehouse loaded", 10_000) { s.isWarehouse && s.openRequests.isNotEmpty() && !s.busy }
        rule.waitForIdle()
        rule.onNodeWithText("Hotels are asking").assertExists()
        rule.onNodeWithText("Demo Hotel 1").assertExists()
        rule.onNodeWithText("Send all").performClick(); pump()
        waitFor(s, "dispatched", 10_000) { received.any { it.path == "/requests/r1/dispatch" } }
        val d = received.last { it.path == "/requests/r1/dispatch" }
        assertEquals("POST", d.method)
        assertTrue(d.getHeader("idempotency-key") != null)
        waitFor(s, "request gone", 10_000) { s.openRequests.isEmpty() }
    }

    /** Warehouse: order from a supplier (typed quantity), send on WhatsApp, check the delivery in, then the same order spoken in one sentence. */
    @Test fun order_from_supplier_and_check_delivery() {
        val s = state().also { it.store.hotelId = "wh"; it.hotelId = "wh" }
        signIn(s)
        s.go(Tab.SUPPLIERS)
        waitFor(s, "suppliers listed", 10_000) { s.suppliers.isNotEmpty() }
        rule.onNodeWithText("Demo Dairy").performClick(); pump()
        waitFor(s, "supplier card", 10_000) { s.page is Page.SupplierCard }
        rule.onNodeWithText("Order").performClick(); pump()
        waitFor(s, "order form pre-filled", 10_000) { (s.page as? Page.OrderForm)?.lines?.firstOrNull()?.qty == 20 }
        // The quantity is a box you type in.
        rule.onNodeWithTag("qty-i1").performTextReplacement("25"); pump()
        assertEquals(25, (s.page as Page.OrderForm).lines[0].qty)
        rule.onNodeWithText("Send to supplier").performClick(); pump()
        waitFor(s, "message preview", 10_000) { s.page is Page.Message }
        val made = received.last { it.path == "/orders" && it.method == "POST" }.body.readUtf8()
        assertTrue(made, made.contains("\"siteId\":\"wh\"") && made.contains("\"supplierId\":\"s1\"") && made.contains("\"quantity\":25"))
        assertTrue(received.none { it.path == "/orders/o1/send" })

        rule.onNodeWithText("Send on WhatsApp").performClick(); pump()
        waitFor(s, "order sent", 10_000) { received.any { it.path == "/orders/o1/send" } && s.page == null && s.home?.deliveriesDue?.isNotEmpty() == true }
        val wa = org.robolectric.Shadows.shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).nextStartedActivity
        assertTrue("$wa", wa?.dataString?.startsWith("https://wa.me/919825000001?text=") == true)

        // The delivery arrives: everything is pre-filled as received; paneer needs a use-by date.
        rule.waitForIdle()
        rule.onNodeWithText("Check").performClick(); pump()
        waitFor(s, "check page", 10_000) { s.page is Page.Check }
        rule.onNodeWithText("1 week").performClick(); pump()
        rule.onNodeWithText("Add to stock").performClick(); pump()
        waitFor(s, "delivery saved", 10_000) { received.any { it.path == "/orders/o1/deliveries" } && s.page == null && !s.busy }
        val d = received.last { it.path == "/orders/o1/deliveries" }
        val checked = d.body.readUtf8()
        assertTrue(checked, checked.contains("\"productId\":\"i1\"") && checked.contains("\"received\":20") && checked.contains("\"expiryDate\":\""))
        assertTrue(d.getHeader("idempotency-key") != null)

        // Spoken in one go: a draft card waits; nothing is saved until Confirm.
        s.go(Tab.TODAY); pump()
        waitFor(s, "today", 10_000) { !s.busy }
        received.clear()
        rule.onNodeWithContentDescription("Ask: “how much soap is left?”").performTextInput("order from demo dairy 20 kilo paneer")
        rule.onNodeWithContentDescription("Send").performClick(); pump()
        waitFor(s, "draft card", 10_000) { s.chat.any { it.body is ChatBody.Draft } && !s.busy }
        rule.waitForIdle()
        assertTrue(received.none { it.path == "/orders" && it.method == "POST" })
        rule.onNodeWithText("Confirm").performClick(); pump()
        waitFor(s, "spoken order saved", 10_000) { s.page is Page.Message }
        val spoken = received.last { it.path == "/orders" && it.method == "POST" }.body.readUtf8()
        assertTrue(spoken, spoken.contains("\"source\":\"VOICE\"") && spoken.contains("\"quantity\":20"))
    }
}
