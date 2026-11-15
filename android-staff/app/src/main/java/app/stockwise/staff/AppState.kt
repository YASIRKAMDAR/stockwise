package app.stockwise.staff

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

enum class Tab { HOME, BAG, HISTORY, ATTEMPTS }
enum class Step { ROOM, ITEMS, CHECK, DONE }
data class Flow(
    val kind: Kind, val step: Step, val roomId: String? = null, val roomNumber: String? = null,
    val cart: Map<String, Int> = emptyMap(), val lines: List<Line> = emptyList(),
    val proposalId: String? = null, val transcript: String? = null, val ref: String? = null, val offline: Boolean = false,
)
data class Notice(val text: String, val warn: Boolean = true)

/** All app state. Screens read it and call its functions; it talks to the server. */
class AppState(ctx: Context) {
    val app: Context = ctx.applicationContext
    val store = Store(app)
    val api = Api(store)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    var lang by mutableStateOf(store.lang)
    val t get() = T(lang)
    var booting by mutableStateOf(true)
    var me by mutableStateOf<Me?>(null)
    var tab by mutableStateOf(Tab.HOME)
    var flow by mutableStateOf<Flow?>(null)
    var products by mutableStateOf<List<Product>>(emptyList())
    var rooms by mutableStateOf<List<Room>>(emptyList())
    var bag by mutableStateOf<Map<String, Int>>(emptyMap())
    var storeQty by mutableStateOf<Map<String, Int>>(emptyMap())
    var history by mutableStateOf<List<Event>>(emptyList())
    var outbox by mutableStateOf(store.outbox)
    var notice by mutableStateOf<Notice?>(null)
    var answer by mutableStateOf<List<QueryRow>?>(null)
    var busy by mutableStateOf(false)
    var loginError by mutableStateOf<String?>(null)
    var nudgeTap by mutableStateOf(false)
    /** The conversation on the home screen: what was said, what the app understood, what was saved. */
    var chat by mutableStateOf<List<ChatMessage>>(emptyList())
    fun post(body: ChatBody, role: Role = Role.APP) { chat = (chat + ChatMessage(role, body)).takeLast(40) }
    fun clearChat() { chat = emptyList(); retryHeard = null; answer = null }
    private fun replaceChat(id: Long, f: (ChatMessage) -> ChatMessage) { chat = chat.map { if (it.id == id) f(it) else it } }
    fun editSaid(text: String) { draft = if (text == "…") "" else text; notice = null }
    private var misses = 0

    val hotelId get() = me?.activeHotel ?: me?.hotels?.firstOrNull()?.id
    val hotel get() = me?.hotels?.firstOrNull { it.id == hotelId }
    fun product(id: String?) = products.firstOrNull { it.id == id }
    fun active() = products.filter { it.active }

    fun boot() = scope.launch {
        booting = true
        if (store.session != null) {
            try { me = api.me(); lang = me!!.language.also { store.lang = it }; refresh(); if (!store.introSeen) showIntro = true }
            catch (e: ApiException) { if (e.status == 401) store.session = null }
            catch (e: OfflineException) { notice = Notice(t.savedOnPhone.substringBefore('.') + "…") }
        }
        booting = false
    }

    fun login(code: String, pin: String) = scope.launch {
        busy = true; loginError = null
        try {
            api.staffLogin(code, pin); store.lastCode = code.trim().uppercase()
            me = api.me(); lang = me!!.language.also { store.lang = it }; tab = Tab.HOME; flow = null; if (!store.introSeen) showIntro = true
            refresh(); OutboxWorker.kick(app)
        } catch (e: ApiException) { loginError = e.message }
        catch (e: OfflineException) { loginError = "No connection. Check the phone's internet and try again." }
        busy = false
    }

    fun signOut() = scope.launch { api.logout(); me = null; flow = null; tab = Tab.HOME; answer = null; notice = null }

    fun setLanguage(l: String) { lang = l; store.lang = l; scope.launch { runCatching { api.setLanguage(l) } } }

    fun refresh() = scope.launch {
        val h = hotelId ?: return@launch
        guard {
            products = api.products()
            rooms = api.rooms(h).filter { it.active }
            bag = api.bag(h).items.associate { it.productId to it.quantity }
            storeQty = api.store(h).items.associate { it.productId to it.store }
        }
        outbox = store.outbox
    }
    fun loadHistory() = scope.launch { val h = hotelId ?: return@launch; guard { history = api.activity(h).items } }

    private suspend fun guard(block: suspend () -> Unit) {
        try { block() }
        catch (e: ApiException) { if (e.status == 401) { store.session = null; me = null } else notice = Notice(e.message) }
        catch (e: OfflineException) { /* keep what we have */ }
    }

    // ---------- starting jobs ----------
    fun start(kind: Kind) { answer = null; notice = null; flow = Flow(kind, if (kind.needsRoom) Step.ROOM else Step.ITEMS) }
    fun tapInstead() = start(Kind.PLACE_IN_ROOM)

    fun defaultSource(productId: String, qty: Int): String =
        if ((bag[productId] ?: 0) >= qty || hotel?.allowStoreToRoom == false) "MY_STOCK" else "STORE"

    fun cartToCheck() {
        val f = flow ?: return
        val lines = f.cart.filter { it.value > 0 }.map { (pid, q) ->
            Line(pid, q, f.roomId, f.roomNumber, if (f.kind == Kind.PLACE_IN_ROOM) defaultSource(pid, q) else null)
        }
        flow = f.copy(step = Step.CHECK, lines = lines)
    }

    /** Text from the mic or the text box → the server works out the job → check screen. */
    /** With Google's model on the server, the recording itself is sent, so mixed languages are understood. */
    val cloudVoice get() = me?.config?.voiceProvider == "gemini"
    /** The language the staff member actually spoke (when it was one language): replies are read aloud in it. */
    var replyLang by mutableStateOf<String?>(null)
    /** Short code for the language tag shown with what was heard: gu / hi / en / mixed. */
    var heardLang by mutableStateOf<String?>(null)
    /** True once a voice request has waited 3 s, so the screen can say it's still asking Google. */
    var waitingLong by mutableStateOf(false)
    /** Text put into the box by "Type it" or by tapping what was heard, to correct before sending. */
    var draft by mutableStateOf("")
    /** Google didn't answer and the server had nothing to fall back on: what the phone heard, for the retry card. */
    var retryHeard by mutableStateOf<String?>(null)
    private var toldNoGuVoice = false
    var showIntro by mutableStateOf(false)
    var practicing by mutableStateOf(false)
    var attempts by mutableStateOf<List<VoiceAttempt>>(emptyList())
    fun loadAttempts() = scope.launch { attempts = runCatching { api.voiceAttempts().attempts }.getOrDefault(emptyList()) }
    /** The walkthrough: shown once after the first sign-in; "How to use" in the menu opens it again. */
    fun finishIntro(practice: Boolean, mic: app.stockwise.staff.ui.Mic? = null) {
        store.introSeen = true; showIntro = false
        if (practice) { practicing = true; tab = Tab.HOME; flow = null; notice = Notice(t.introPractice, warn = false); mic?.let { speak(it, t.introPractice, lang) } }
    }
    /** Read aloud in the language spoken; if this phone has no voice for it, the Mic falls back and we say so once. */
    fun speak(mic: app.stockwise.staff.ui.Mic, text: String, lang: String) {
        if (lang == "gu" && !mic.hasVoice("gu") && !toldNoGuVoice) { toldNoGuVoice = true; notice = Notice(t.noGuVoice, warn = false) }
        mic.say(text, lang)
    }

    private fun applyCommand(c: LocalCommand) {
        misses = 0
        when (c) {
            is LocalCommand.Go -> {
                if (c.tab == Tab.BAG) {
                    // "My bag" answers in the thread instead of leaving it.
                    post(ChatBody.Bag(active().mapNotNull { p -> bag[p.id]?.takeIf { it > 0 }?.let { p to it } }))
                    if (practicing) { practicing = false; post(ChatBody.Text(t.introDone, false)); notice = null }
                } else { flow = null; tab = c.tab; if (c.tab == Tab.HISTORY) loadHistory() }
            }
            is LocalCommand.Language -> setLanguage(c.lang)
            LocalCommand.SignOut -> signOut()
        }
    }

    fun interpret(text: String, durationMs: Long) = scope.launch {
        val h = hotelId ?: return@launch
        notice = null; answer = null
        post(ChatBody.Said(text, durationMs > 0), Role.ME)
        localCommand(text)?.let { applyCommand(it); return@launch }
        run { api.interpret(h, text, lang, durationMs) }
    }

    /** A recording: Google's model hears it, whatever mix of languages was spoken. The bubble shows what the phone heard until Google's version arrives. */
    fun interpretAudio(audio: ByteArray, durationMs: Long, heard: String = "") = scope.launch {
        val h = hotelId ?: return@launch
        notice = null; answer = null
        val bubble = ChatMessage(Role.ME, ChatBody.Said(if (heard.isBlank()) "…" else heard, true))
        chat = (chat + bubble).takeLast(40)
        run(fromRecording = true, heard = heard, bubbleId = bubble.id) { api.interpretAudio(h, audio, lang, durationMs, heard) }
    }

    private suspend fun run(fromRecording: Boolean = false, heard: String = "", bubbleId: Long? = null, call: suspend () -> Proposal) {
        busy = true; waitingLong = false; retryHeard = null
        // After 3 s the spinner says the app is still waiting for Google, so the screen never looks frozen.
        val waiter = scope.launch { delay(3000); waitingLong = true }
        try {
            val p = call()
            replyLang = when (p.detectedLanguage) { "gu-IN" -> "gu"; "hi-IN" -> "hi"; "en-IN" -> "en"; else -> null }
            heardLang = replyLang ?: if (p.detectedLanguage == "mixed") "mixed" else null
            if (bubbleId != null) replaceChat(bubbleId) { m -> val said = m.body as ChatBody.Said; m.copy(body = said.copy(text = p.transcript.ifBlank { said.text }, lang = heardLang)) }
            else chat.lastOrNull { it.role == Role.ME }?.let { m -> replaceChat(m.id) { x -> val said = x.body as ChatBody.Said; x.copy(body = said.copy(lang = heardLang)) } }
            if (fromRecording) localCommand(p.transcript)?.let { applyCommand(it); busy = false; return }
            if ("FALLBACK_RULES" in p.warnings) post(ChatBody.Text(t.fromPhoneWords, true))
            val kind = Kind.of(p.action)
            when {
                p.status == "QUERY_RESULT" -> { post(ChatBody.Stock(p.queryResult ?: emptyList())); misses = 0 }
                kind != null && p.lines.isNotEmpty() -> {
                    misses = 0
                    val lines = p.lines.map { l ->
                        val q = l.quantity ?: 1
                        Line(l.productId, q, l.roomId, l.roomNumber,
                            if (kind == Kind.PLACE_IN_ROOM) (l.source ?: l.productId?.let { defaultSource(it, q) }) else null,
                            l.spokenProduct, l.issues)
                    }
                    val room = lines.firstOrNull { it.roomId != null }
                    val f = Flow(kind, Step.CHECK, room?.roomId, room?.roomNumber, lines = lines, proposalId = p.proposalId, transcript = p.transcript)
                    // Something to pick (unknown item, no room): the full check screen has the pickers. Otherwise a card in the thread.
                    if (blocked(f)) flow = f else post(ChatBody.Job(f))
                }
                // "Take from store" with no items: open that job so they can pick the items.
                kind != null -> { misses = 0; start(kind) }
                else -> missed()
            }
        } catch (e: ApiException) {
            when {
                e.status == 401 -> { store.session = null; me = null }
                e.status >= 500 && fromRecording -> post(ChatBody.Retry(heard))      // Google slow and nothing to fall back on
                else -> post(ChatBody.Text(e.message, true))
            }
        }
        catch (e: OfflineException) { if (fromRecording) post(ChatBody.Retry(heard)) else post(ChatBody.Text(t.noVoice, true)) }
        waiter.cancel(); waitingLong = false
        busy = false
    }
    fun missed() {
        misses += 1; nudgeTap = true
        if (misses >= 2) { misses = 0; post(ChatBody.Text(t.twiceFailed, true)); start(Kind.PLACE_IN_ROOM) } else post(ChatBody.Text(t.notUnderstood, true))
    }

    // ---------- the job card in the thread ----------
    fun confirmChat(id: Long) = scope.launch {
        val m = chat.firstOrNull { it.id == id } ?: return@launch
        val job = m.body as? ChatBody.Job ?: return@launch
        if (job.state != ChatState.READY || busy) return@launch
        replaceChat(id) { it.copy(body = job.copy(state = ChatState.SAVING)) }
        when (val r = save(job.flow)) {
            is SaveOutcome.Saved -> replaceChat(id) { it.copy(body = job.copy(state = ChatState.SAVED, ref = r.ref)) }
            SaveOutcome.Queued -> replaceChat(id) { it.copy(body = job.copy(state = ChatState.OFFLINE)) }
            is SaveOutcome.Failed -> { replaceChat(id) { it.copy(body = job.copy(state = ChatState.READY)) }; post(ChatBody.Text(r.message, true)) }
        }
    }
    fun cancelChat(id: Long) { replaceChat(id) { m -> (m.body as? ChatBody.Job)?.let { m.copy(body = it.copy(state = ChatState.CANCELLED)) } ?: m } }
    /** Open the full check screen to change items; the card is dropped, the screen takes over. */
    fun editChat(id: Long) {
        val job = chat.firstOrNull { it.id == id }?.body as? ChatBody.Job ?: return
        chat = chat.filter { it.id != id }
        flow = job.flow
    }

    sealed class SaveOutcome { data class Saved(val ref: String) : SaveOutcome(); object Queued : SaveOutcome(); data class Failed(val message: String) : SaveOutcome() }
    /** Save a job. Without signal it is kept on the phone and sent later, never twice. */
    private suspend fun save(f: Flow): SaveOutcome {
        val h = hotelId ?: return SaveOutcome.Failed("")
        busy = true; notice = null
        val key = UUID.randomUUID().toString()
        val body = json.encodeToString(TxBody.serializer(), TxBody(f.kind.api, h,
            f.lines.map { TxLineBody(it.productId!!, it.quantity, if (f.kind == Kind.PLACE_IN_ROOM) it.roomId else null, if (f.kind == Kind.PLACE_IN_ROOM) it.source else null) }, f.proposalId))
        val out: SaveOutcome = try {
            val r = json.decodeFromString(TxResult.serializer(), api.post("/transactions", body, key))
            me?.let { u -> store.addRecentRooms(u.id, f.lines.mapNotNull { it.roomNumber }.distinct()) }
            refresh()
            SaveOutcome.Saved(r.refCode ?: r.eventId.take(6).uppercase())
        } catch (e: OfflineException) {
            store.enqueue(Pending(key, body, summary(f), System.currentTimeMillis())); outbox = store.outbox
            OutboxWorker.kick(app)
            SaveOutcome.Queued
        } catch (e: ApiException) {
            if (e.status == 401) { store.session = null; me = null }
            SaveOutcome.Failed(e.message)
        }
        busy = false
        return out
    }

    fun blocked(f: Flow): Boolean = f.lines.isEmpty() || f.lines.any { it.productId == null || it.quantity < 1 || (f.kind == Kind.PLACE_IN_ROOM && (it.roomId == null || it.source == null)) }

    fun summary(f: Flow) = t.summary(f.kind, f.lines.sumOf { it.quantity }, f.lines.firstOrNull { it.roomNumber != null }?.roomNumber)

    /** Save the job from the full check screen. */
    fun confirm() = scope.launch {
        val f = flow ?: return@launch
        if (blocked(f) || busy) return@launch
        when (val r = save(f)) {
            is SaveOutcome.Saved -> flow = f.copy(step = Step.DONE, ref = r.ref)
            SaveOutcome.Queued -> flow = f.copy(step = Step.DONE, offline = true)
            is SaveOutcome.Failed -> if (r.message.isNotBlank()) notice = Notice(r.message)
        }
    }

    fun sendOutbox() { OutboxWorker.kick(app); scope.launch { kotlinx.coroutines.delay(2500); outbox = store.outbox; refresh() } }
    fun discardPending(key: String) { store.dequeue(key); outbox = store.outbox }
}
