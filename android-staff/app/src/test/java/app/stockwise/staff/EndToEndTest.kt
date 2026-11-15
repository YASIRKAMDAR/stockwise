package app.stockwise.staff

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.stockwise.staff.ui.Mic
import app.stockwise.staff.ui.StaffApp
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The staff app driven end to end against a fake Stockwise server: sign in, type a job (the same path speech takes),
 * check the card, confirm, and see the server receive exactly one transaction with an idempotency key.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class EndToEndTest {
    @get:Rule val rule = createComposeRule()
    private lateinit var server: MockWebServer
    private val received = mutableListOf<RecordedRequest>()

    private val mic = object : Mic {
        override val available = false          // no recogniser in the test VM; typing goes through the same server path
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
                return when {
                    p.endsWith("/auth/staff-login") && request.method == "POST" ->
                        json("""{"ok":true}""").addHeader("Set-Cookie", "sw_session=abc; Path=/; HttpOnly")
                    p.endsWith("/me") && request.method == "GET" -> json("""{"id":"u1","displayName":"Staff 101","employeeCode":"S101","role":"STAFF","authMethod":"PIN","language":"en",
                        "hotels":[{"id":"h1","name":"Demo Hotel 1","code":"H1","roles":["STAFF"]}],"activeHotel":"h1","config":{"voiceProvider":"fake","voiceMaxSeconds":25}}""")
                    p.endsWith("/products") -> json("""[{"id":"p1","sku":"SOAP","name":"Soap","unit":"pcs","aliases":[]},{"id":"p2","sku":"SHAMPOO","name":"Shampoo","unit":"pcs","aliases":[]}]""")
                    p.contains("/hotels/h1/rooms") -> json("""[{"id":"r203","roomNumber":"203"},{"id":"r204","roomNumber":"204"}]""")
                    p.startsWith("/me/stock") -> json("""{"items":[{"productId":"p1","name":"Soap","quantity":8},{"productId":"p2","name":"Shampoo","quantity":4}]}""")
                    p.contains("/hotels/h1/stock") -> json("""{"items":[{"productId":"p1","name":"Soap","store":180},{"productId":"p2","name":"Shampoo","store":110}]}""")
                    p.endsWith("/voice/interpret") -> json("""{"proposalId":"prop-1","status":"READY_TO_CONFIRM","action":"PLACE_IN_ROOM","transcript":"Room 203 ma do soap mukya","detectedLanguage":"mixed",
                        "lines":[{"productId":"p1","productName":"Soap","spokenProduct":"soap","quantity":2,"roomId":"r203","roomNumber":"203","source":"MY_STOCK","issues":[]}],"warnings":[]}""")
                    p.endsWith("/transactions") && request.method == "POST" -> json("""{"eventId":"evt-123456","refCode":"A1B2C3"}""", 201)
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
            if (System.currentTimeMillis() > end) throw AssertionError("Timed out waiting for $what. loginError=${s.loginError} notice=${s.notice} busy=${s.busy} chat=${s.chat.map { it.body::class.simpleName }} flow=${s.flow?.step} requests=${received.map { "${it.method} ${it.path}" }}")
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            rule.waitForIdle()
            Thread.sleep(25)
        }
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        rule.waitForIdle()
    }

    private fun state() = AppState(ApplicationProvider.getApplicationContext(), server.url("/").toString().trimEnd('/')).also { it.booting = false; it.lang = "en"; it.store.introSeen = true }

    @Test fun signIn_typeJob_confirm_savesOnce() {
        val s = state()
        rule.setContent { StaffApp(s, mic) }

        // Sign in with code + passcode.
        rule.onAllNodes(hasSetTextAction())[0].performTextInput("S101")
        rule.onAllNodes(hasSetTextAction())[1].performTextInput("1234")
        rule.onNode(hasText("Sign in") and hasClickAction()).performClick(); pump()
        waitFor(s, "s.me != null", 10_000) { s.me != null }
        waitFor(s, "s.products.isNotEmpty()", 10_000) { s.products.isNotEmpty() && !s.busy }
        rule.onNodeWithText("Hold to talk").assertExists()

        // Type what would have been said; the server reads it the same way as speech.
        rule.onNodeWithContentDescription("Type: room 203, 2 soap").performTextInput("room 203, 2 soap")
        rule.onNodeWithContentDescription("Send").performClick(); pump()
        waitFor(s, "s.chat.any { it.body is ChatBody.Job }", 10_000) { s.chat.any { it.body is ChatBody.Job } && !s.busy }
        rule.waitForIdle()

        // The card shows Google's version of the words, the language tag, the room and the line. Nothing saved yet.
        rule.onNodeWithText("Room 203 ma do soap mukya").assertExists()
        rule.onNodeWithText("Mixed").assertExists()
        rule.onNodeWithText("203").assertExists()
        assertTrue(received.none { it.path == "/transactions" && it.method == "POST" })

        // Confirm → one POST /transactions with an idempotency key and the proposal id → "Saved ✓ · A1B2C3".
        rule.onNodeWithText("Confirm").performClick(); pump()
        waitFor(s, "s.chat.any { (it.body as? ChatBody.Job)?.state == ChatState.SAVED }", 10_000) { s.chat.any { (it.body as? ChatBody.Job)?.state == ChatState.SAVED } && !s.busy }
        rule.waitForIdle()
        rule.onNodeWithText("Saved ✓ · A1B2C3").assertExists()
        val posts = received.filter { it.path == "/transactions" && it.method == "POST" }
        assertEquals(1, posts.size)
        assertNotNull(posts[0].getHeader("idempotency-key"))
        val body = posts[0].body.readUtf8()
        assertTrue(body, body.contains("\"action\":\"PLACE_IN_ROOM\"") && body.contains("\"productId\":\"p1\"") && body.contains("\"quantity\":2") && body.contains("\"roomId\":\"r203\"") && body.contains("\"proposalId\":\"prop-1\""))
        assertEquals("stockwise", posts[0].getHeader("x-requested-with"))

        // "my bag" is answered in the thread without a server call.
        val before = received.size
        rule.onNodeWithContentDescription("Type: room 203, 2 soap").performTextInput("my bag")
        rule.onNodeWithContentDescription("Send").performClick(); pump()
        waitFor(s, "s.chat.any { it.body is ChatBody.Bag }", 5_000) { s.chat.any { it.body is ChatBody.Bag } }
        rule.waitForIdle()
        rule.onNodeWithText("In your bag").assertExists()
        rule.onNode(hasText("8")).assertExists()
        assertTrue(received.drop(before).none { it.path?.endsWith("/voice/interpret") == true })
    }

    @Test fun cancelOnCard_savesNothing() {
        val s = state()
        rule.setContent { StaffApp(s, mic) }
        rule.onAllNodes(hasSetTextAction())[0].performTextInput("S101")
        rule.onAllNodes(hasSetTextAction())[1].performTextInput("1234")
        rule.onNode(hasText("Sign in") and hasClickAction()).performClick(); pump()
        waitFor(s, "s.products.isNotEmpty()", 10_000) { s.products.isNotEmpty() && !s.busy }
        rule.onNodeWithContentDescription("Type: room 203, 2 soap").performTextInput("room 203, 2 soap")
        rule.onNodeWithContentDescription("Send").performClick(); pump()
        waitFor(s, "s.chat.any { it.body is ChatBody.Job }", 10_000) { s.chat.any { it.body is ChatBody.Job } && !s.busy }
        rule.waitForIdle()
        rule.onNodeWithText("Cancel").performClick(); pump()
        rule.waitForIdle()
        rule.onNodeWithText("Cancelled").assertExists()
        assertTrue(received.none { it.path == "/transactions" && it.method == "POST" })
    }
}
