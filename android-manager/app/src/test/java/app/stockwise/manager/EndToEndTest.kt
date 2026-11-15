package app.stockwise.manager

import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
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
                        "hotels":[{"id":"h1","name":"Demo Hotel 1","code":"H1","roles":["MANAGER"]},{"id":"h2","name":"Demo Hotel 2","code":"H2","roles":["MANAGER"]}],"config":{"voiceProvider":"fake"}}""")
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
                        else
                            json("""{"proposalId":"pq","status":"QUERY_RESULT","action":"STOCK_QUERY","transcript":"Soap kitna bacha hai?","detectedLanguage":"hi-IN","lines":[],"warnings":[],
                                "queryResult":[{"productId":"p1","name":"Soap","unit":"pcs","store":0,"staffHeld":14,"inTransit":0,"hotelName":"Demo Hotel 1","low":true}]}""")
                    }
                    p.startsWith("/transfers?") -> json("""[{"id":"t1","refCode":"T-118","status":"OPEN","dispatchedAt":"2026-11-14T09:05:00Z","fromHotel":{"id":"h2","name":"Demo Hotel 2"},"toHotel":{"id":"h1","name":"Demo Hotel 1"},
                        "lines":[{"productId":"p2","name":"Shampoo","sent":40,"received":0,"resolvedShort":0}],"outstandingUnits":40,"ageHours":5.0,"aged":false}]""")
                    p.endsWith("/transfers/t1/receipts") && request.method == "POST" -> json("""{"ok":true}""", 201)
                    p.startsWith("/transactions") -> json("""{"items":[]}""")
                    p.startsWith("/me/voice-attempts") -> json("""{"attempts":[]}""")
                    else -> json("""{"error":{"code":"NOT_FOUND","message":"no route $p"}}""", 404)
                }
            }
        }
        server.start()
    }
    @After fun stopServer() { server.shutdown() }
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

    private fun state() = AppState(ApplicationProvider.getApplicationContext(), server.url("/").toString().trimEnd('/')).also { it.booting = false; it.lang = "en"; it.store.introSeen = true }

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
        rule.onNodeWithText("Soap kitna bacha hai?").assertExists()
        rule.onNodeWithText("हिंदी").assertExists()
        rule.onNodeWithText("14 with staff").assertExists()
        val interpret = received.last { it.path?.endsWith("/voice/interpret") == true }
        val form = interpret.body.readUtf8()
        assertTrue(form.contains("name=\"scope\"\r\n\r\nall") && form.contains("name=\"client\"\r\n\r\nandroid-manager") && !form.contains("name=\"mode\""))

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
        assertTrue(countForm.contains("name=\"mode\"\r\n\r\ncount"))

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
}
