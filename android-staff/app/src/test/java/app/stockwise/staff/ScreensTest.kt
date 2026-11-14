package app.stockwise.staff

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.stockwise.staff.ui.Mic
import app.stockwise.staff.ui.StaffApp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Renders the staff screens with sample data so they can be reviewed without a phone. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-xxhdpi")
class ScreensTest {
    @get:Rule val rule = createComposeRule()

    private val mic = object : Mic {
        override val available = true
        override fun hasPermission() = true
        override fun requestPermission() {}
        override fun start(lang: String, onInterim: (String) -> Unit, onDone: (String?, Int?) -> Unit) { onInterim("Room 203, two soap and one shampoo") }
        override fun release() {}
        override fun cancel() {}
        override fun say(text: String, lang: String) {}
    }

    private fun state(): AppState {
        val s = AppState(ApplicationProvider.getApplicationContext())
        s.booting = false
        s.lang = "en"
        s.me = Me("u1", "Staff 101", "S101", "STAFF", "PIN", "en", listOf(Hotel("h1", "Demo Hotel 1", "H1", roles = listOf("STAFF"))), "h1", MeConfig("fake", 25))
        fun p(id: String, sku: String, name: String, gu: String) = Product(id, sku, name, aliases = listOf(Alias("gu", gu)))
        s.products = listOf(p("p1", "SOAP", "Soap", "સાબુ"), p("p2", "SHAMPOO", "Shampoo", "શેમ્પૂ"), p("p3", "COMB", "Comb", "કાંસકો"),
            p("p4", "DENTAL_KIT", "Dental kit", "ડેન્ટલ કિટ"), p("p5", "TOOTHBRUSH", "Toothbrush", "બ્રશ"), p("p6", "TOOTHPASTE", "Toothpaste", "પેસ્ટ"))
        s.rooms = (201..210).map { Room("r$it", "$it") } + (101..105).map { Room("r$it", "$it") }
        s.bag = mapOf("p1" to 8, "p2" to 4)
        s.storeQty = mapOf("p1" to 180, "p2" to 110, "p3" to 80, "p4" to 70, "p5" to 70, "p6" to 60)
        s.history = listOf(
            Event("e1", "PLACE_IN_ROOM", "2026-11-14T10:05:00Z", viaVoice = true, lines = listOf(EventLine("p1", "Soap", 2, "203"), EventLine("p2", "Shampoo", 1, "203"))),
            Event("e2", "CHECKOUT_TO_STAFF", "2026-11-14T09:40:00Z", lines = listOf(EventLine("p1", "Soap", 10))),
        )
        return s
    }
    private fun shot(name: String, s: AppState, drawer: Boolean = false) {
        rule.setContent { StaffApp(s, mic, drawer) }
        rule.onRoot().captureRoboImage("build/screens/$name.png")
    }

    @Test fun s01_login() { val s = state(); s.me = null; shot("01-sign-in", s) }
    @Test fun s02_home() = shot("02-home", state())
    @Test fun s03_menu() = shot("03-menu", state(), drawer = true)
    @Test fun s04_holding() {
        val s = state()
        rule.setContent { StaffApp(s, mic) }
        rule.onNodeWithContentDescription("Hold to talk").performTouchInput { down(center) }
        rule.mainClock.advanceTimeBy(1300)
        rule.onRoot().captureRoboImage("build/screens/04-holding-mic.png")
    }
    @Test fun s05_room() { val s = state(); s.flow = Flow(Kind.PLACE_IN_ROOM, Step.ROOM); shot("05-which-room", s) }
    @Test fun s06_items() { val s = state(); s.flow = Flow(Kind.PLACE_IN_ROOM, Step.ITEMS, "r203", "203", cart = mapOf("p1" to 2, "p2" to 1)); shot("06-items", s) }
    @Test fun s07_check() {
        val s = state()
        s.flow = Flow(Kind.PLACE_IN_ROOM, Step.CHECK, "r203", "203", proposalId = "x", transcript = "Room 203, two soap and one shampoo",
            lines = listOf(Line("p1", 2, "r203", "203", "MY_STOCK"), Line("p2", 1, "r203", "203", "MY_STOCK")))
        shot("07-check", s)
    }
    @Test fun s08_done() {
        val s = state()
        s.flow = Flow(Kind.PLACE_IN_ROOM, Step.DONE, "r203", "203", ref = "DEFB28", lines = listOf(Line("p1", 2, "r203", "203", "MY_STOCK"), Line("p2", 1, "r203", "203", "MY_STOCK")))
        shot("08-saved", s)
    }
    @Test fun s09_offline() {
        val s = state()
        s.flow = Flow(Kind.PLACE_IN_ROOM, Step.DONE, "r203", "203", offline = true, lines = listOf(Line("p1", 2, "r203", "203", "MY_STOCK")))
        shot("09-saved-offline", s)
    }
    @Test fun s10_bag() { val s = state(); s.tab = Tab.BAG; shot("10-my-bag", s) }
    @Test fun s11_history() { val s = state(); s.tab = Tab.HISTORY; shot("11-history", s) }
    @Test fun s12_gujarati() { val s = state(); s.lang = "gu"; shot("12-home-gujarati", s) }
}
