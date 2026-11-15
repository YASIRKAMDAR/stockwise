package app.stockwise.manager

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.stockwise.manager.ui.Mic
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

/** Everything the manager app knows: who's signed in, which hotel, the screens' data, and the voice conversation. */
class AppState(ctx: Context) {
    val app: Context = ctx.applicationContext
    val store = Store(app)
    val api = Api(store)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    var lang by mutableStateOf(store.lang)
    val t get() = T(lang)
    var booting by mutableStateOf(true)
    var me by mutableStateOf<Me?>(null)
    var hotelId by mutableStateOf(store.hotelId)
    var tab by mutableStateOf(Tab.TODAY)
    var notice by mutableStateOf<Notice?>(null)
    var busy by mutableStateOf(false)
    var loginError by mutableStateOf<String?>(null)

    // Screen data
    var products by mutableStateOf<List<Product>>(emptyList())
    var stock by mutableStateOf<List<StockRow>>(emptyList())
    var alerts by mutableStateOf<List<Alert>>(emptyList())
    var corrections by mutableStateOf<List<CorrectionRequest>>(emptyList())
    var countStatus by mutableStateOf<CountStatus?>(null)
    var sheet by mutableStateOf<CountSheet?>(null)
    var pastCounts by mutableStateOf<List<CountSummary>>(emptyList())
    var transfers by mutableStateOf<List<Transfer>>(emptyList())
    var recentTransfers by mutableStateOf<List<Transfer>>(emptyList())
    var events by mutableStateOf<List<Event>>(emptyList())
    var attempts by mutableStateOf<List<VoiceAttempt>>(emptyList())
    var countSaving by mutableStateOf(false)

    // Voice / conversation
    var chat by mutableStateOf<List<ChatMessage>>(emptyList())
    var waitingLong by mutableStateOf(false)
    var draft by mutableStateOf("")
    var retryHeard by mutableStateOf<String?>(null)
    var showIntro by mutableStateOf(false)
    var practicing by mutableStateOf(false)
    private var toldNoGuVoice = false

    val hotel get() = me?.hotels?.firstOrNull { it.id == hotelId }
    val hotels get() = me?.hotels ?: emptyList()
    val cloudVoice get() = me?.config?.voiceProvider == "gemini"
    fun product(id: String?) = products.firstOrNull { it.id == id }
    val attentionCount get() = alerts.size + corrections.size
    /** On the count screen, spoken numbers are physical counts. */
    val voiceMode: String? get() = if (tab == Tab.COUNT && sheet != null) "count" else null

    // ---------- session ----------
    fun boot() = scope.launch {
        booting = true
        if (store.session != null) {
            try { loadMe(); loadAll(); if (!store.introSeen) showIntro = true }
            catch (e: ApiException) { if (e.status == 401) store.session = null }
            catch (e: OfflineException) { notice = Notice(t.offlineLogin) }
        }
        booting = false
    }
    private suspend fun loadMe() {
        val m = api.me(); me = m
        if (m.language in listOf("en", "hi", "gu")) { lang = m.language; store.lang = m.language }
        if (hotelId == null || m.hotels.none { it.id == hotelId }) { hotelId = m.hotels.firstOrNull()?.id; store.hotelId = hotelId }
    }
    fun login(code: String, password: String) = scope.launch {
        busy = true; loginError = null
        try {
            api.login(code, password); loadMe()
            val m = me
            if (m == null || (m.role != "MANAGER" && m.role != "OWNER")) { api.logout(); me = null; loginError = t.notManager }
            else { store.lastCode = code; loadAll(); if (!store.introSeen) showIntro = true }
        } catch (e: ApiException) { loginError = e.message } catch (e: OfflineException) { loginError = t.offlineLogin }
        busy = false
    }
    fun signOut() = scope.launch { api.logout(); me = null; chat = emptyList(); stock = emptyList(); alerts = emptyList(); sheet = null }
    fun setLanguage(l: String) { lang = l; store.lang = l; scope.launch { runCatching { api.setLanguage(l) } } }
    fun setHotel(id: String) { hotelId = id; store.hotelId = id; chat = emptyList(); sheet = null; scope.launch { loadAll() } }

    // ---------- data ----------
    suspend fun loadAll() {
        val h = hotelId ?: return
        try {
            products = api.products().filter { it.active }
            stock = api.stock(h).items
            alerts = api.alerts(h).items
            corrections = runCatching { api.corrections(h) }.getOrDefault(emptyList())
            countStatus = runCatching { api.countStatus(h).firstOrNull() }.getOrNull()
        } catch (e: Exception) { handle(e) }
    }
    fun refresh() = scope.launch { loadAll(); loadTab(tab) }
    suspend fun loadTab(to: Tab) {
        val h = hotelId ?: return
        try {
            when (to) {
                Tab.TODAY -> loadAll()
                Tab.STOCK -> stock = api.stock(h).items
                Tab.COUNT -> {
                    countStatus = api.countStatus(h).firstOrNull()
                    sheet = countStatus?.draftCountId?.let { api.count(it) }
                    pastCounts = runCatching { api.counts(h) }.getOrDefault(emptyList())
                }
                Tab.DELIVERIES -> {
                    val all = api.transfers(h)
                    val open = setOf("OPEN", "DISCREPANCY", "PARTIAL")
                    transfers = all.filter { it.status in open }
                    recentTransfers = all.filter { it.status !in open }.take(10)
                }
                Tab.ACTIVITY -> { events = api.activity(h).items; corrections = runCatching { api.corrections(h) }.getOrDefault(emptyList()) }
                Tab.ATTEMPTS -> attempts = runCatching { api.voiceAttempts().attempts }.getOrDefault(emptyList())
            }
        } catch (e: Exception) { handle(e) }
    }
    fun go(to: Tab) { tab = to; scope.launch { loadTab(to) } }
    private fun handle(e: Exception) {
        when (e) {
            is ApiException -> if (e.status == 401) { store.session = null; me = null } else notice = Notice(e.message)
            is OfflineException -> notice = Notice(t.offlineLogin)
            else -> notice = Notice(e.message ?: "Error")
        }
    }
    fun alertAction(a: Alert): Pair<String, Tab>? = when {
        a.category == "LOW_STOCK" -> t.seeStock to Tab.STOCK
        a.category == "COUNT_OVERDUE" -> t.startCount to Tab.COUNT
        a.category == "LARGE_VARIANCE" -> t.review to Tab.COUNT
        a.category == "CORRECTION_REQUEST" -> t.review to Tab.ACTIVITY
        a.category.startsWith("TRANSFER") -> t.open to Tab.DELIVERIES
        else -> null
    }

    // ---------- weekly count ----------
    fun startCount() = scope.launch { val h = hotelId ?: return@launch; try { sheet = api.startCount(h); countStatus = api.countStatus(h).firstOrNull() } catch (e: Exception) { handle(e) } }
    fun setCount(productId: String, qty: Int?, reason: String? = null) {
        val s = sheet ?: return
        val lines = s.lines.map { l ->
            if (l.productId != productId) l
            else l.copy(physicalQty = qty, variance = qty?.minus(l.expectedQty), reason = reason ?: if (qty == l.expectedQty) null else l.reason)
        }
        sheet = s.copy(lines = lines)
        val l = lines.first { it.productId == productId }
        saveCountLines(listOf(CountPatchLine(productId, qty, l.reason)))
    }
    private fun saveCountLines(lines: List<CountPatchLine>) {
        val id = sheet?.id ?: return
        countSaving = true
        scope.launch { try { api.patchCount(id, lines) } catch (e: Exception) { handle(e) }; countSaving = false }
    }
    /** Counts read out by voice: fill the matching boxes; a product with no number means "same as the book". */
    fun applyCounted(p: Proposal, mic: Mic) {
        val s = sheet ?: return
        val got = mutableListOf<Pair<String, Int?>>()
        val patch = mutableListOf<CountPatchLine>()
        var lines = s.lines
        for (pl in p.lines) {
            val pid = pl.productId ?: continue
            val cur = lines.firstOrNull { it.productId == pid } ?: continue
            val qty = pl.quantity ?: cur.expectedQty
            val reason = if (qty == cur.expectedQty) null else cur.reason
            lines = lines.map { if (it.productId == pid) it.copy(physicalQty = qty, variance = qty - it.expectedQty, reason = reason) else it }
            got += cur.name to qty
            patch += CountPatchLine(pid, qty, reason)
        }
        sheet = s.copy(lines = lines)
        if (patch.isNotEmpty()) saveCountLines(patch)
        post(ChatBody.Counted(got))
        speak(mic, got.joinToString(", ") { "${it.first} ${it.second ?: 0}" }, lang)
    }
    val countReady: Pair<Boolean, String?> get() {
        val s = sheet ?: return false to null
        if (s.lines.any { it.physicalQty == null }) return false to t.countNeedsAll
        if (s.lines.any { (it.variance ?: 0) != 0 && it.reason.isNullOrEmpty() }) return false to t.countNeedsReasons
        return true to null
    }
    fun submitCount(mic: Mic) = scope.launch {
        val s = sheet ?: return@launch
        val (ok, why) = countReady
        if (!ok) { notice = Notice(why ?: ""); return@launch }
        try {
            api.submitCount(s.id, UUID.randomUUID().toString())
            sheet = null; notice = Notice(t.countSubmitted, warn = false); speak(mic, t.countSubmitted, lang)
            loadAll(); loadTab(Tab.COUNT)
        } catch (e: ApiException) {
            if (e.status == 409) { runCatching { api.refreshCount(s.id) }; sheet = runCatching { api.count(s.id) }.getOrNull(); notice = Notice(t.stockMoved) } else handle(e)
        } catch (e: Exception) { handle(e) }
    }
    fun cancelCount() = scope.launch { val s = sheet ?: return@launch; runCatching { api.cancelCount(s.id) }; sheet = null; loadTab(Tab.COUNT) }

    // ---------- deliveries ----------
    private fun afterWrite() = scope.launch { notice = Notice(t.saved, warn = false); loadTab(Tab.DELIVERIES); loadAll() }
    fun receiveAll(tr: Transfer) = scope.launch {
        try { api.receive(tr.id, tr.lines.map { ReceiveLine(it.productId, it.sent - it.received - it.resolvedShort) }, true, UUID.randomUUID().toString()); afterWrite() } catch (e: Exception) { handle(e) }
    }
    fun receiveSome(tr: Transfer, quantities: Map<String, Int>, final: Boolean) = scope.launch {
        try { api.receive(tr.id, quantities.map { ReceiveLine(it.key, it.value) }, final, UUID.randomUUID().toString()); afterWrite() } catch (e: Exception) { handle(e) }
    }
    fun settle(tr: Transfer, reason: String) = scope.launch { try { api.resolve(tr.id, reason, UUID.randomUUID().toString()); afterWrite() } catch (e: Exception) { handle(e) } }
    fun dispatch(to: String, quantities: Map<String, Int>) = scope.launch {
        val h = hotelId ?: return@launch
        val lines = quantities.filter { it.value > 0 }.map { DispatchLine(it.key, it.value) }
        if (lines.isEmpty()) return@launch
        try { api.dispatch(h, to, lines, UUID.randomUUID().toString()); afterWrite() } catch (e: Exception) { handle(e) }
    }

    // ---------- activity ----------
    fun reverse(e: Event, reason: String) = scope.launch {
        try { api.reverse(e.eventId, reason, UUID.randomUUID().toString()); notice = Notice(t.reversed, warn = false); loadTab(Tab.ACTIVITY); loadAll() } catch (x: Exception) { handle(x) }
    }
    fun dismiss(c: CorrectionRequest) = scope.launch { runCatching { api.dismissCorrection(c.id) }; corrections = corrections.filter { it.id != c.id } }
    fun eventFor(c: CorrectionRequest) = events.firstOrNull { it.eventId == c.eventId }

    // ---------- walkthrough ----------
    fun finishIntro(practice: Boolean, mic: Mic? = null) {
        store.introSeen = true; showIntro = false
        if (practice) { practicing = true; tab = Tab.TODAY; notice = Notice(t.introPractice, warn = false); mic?.let { speak(it, t.introPractice, lang) } }
    }

    // ---------- conversation ----------
    fun post(body: ChatBody, role: Role = Role.APP) { chat = (chat + ChatMessage(role, body)).takeLast(30) }
    fun clearChat() { chat = emptyList(); retryHeard = null }
    fun editSaid(text: String) { draft = if (text == "…") "" else text; notice = null }
    /** Read aloud in the language spoken; if this phone has no voice for it, the Mic falls back and we say so once. */
    fun speak(mic: Mic, text: String, lang: String) {
        if (text.isBlank()) return
        if (lang == "gu" && !mic.hasVoice("gu") && !toldNoGuVoice) { toldNoGuVoice = true; notice = Notice(t.noGuVoice, warn = false) }
        mic.say(text, lang)
    }
    private fun langCode(detected: String?) = when (detected) { "gu-IN" -> "gu"; "hi-IN" -> "hi"; "en-IN" -> "en"; "mixed" -> "mixed"; else -> null }

    fun interpret(text: String, durationMs: Long, mic: Mic) = scope.launch {
        val h = hotelId ?: return@launch
        notice = null
        post(ChatBody.Said(text, durationMs > 0), Role.ME)
        localCommand(text)?.let { applyLocal(it); return@launch }
        run(mic) { api.interpret(h, text, lang, durationMs, voiceMode) }
    }
    fun interpretAudio(audio: ByteArray, durationMs: Long, heard: String, mic: Mic) = scope.launch {
        val h = hotelId ?: return@launch
        notice = null
        val bubble = ChatMessage(Role.ME, ChatBody.Said(if (heard.isBlank()) "…" else heard, true))
        chat = (chat + bubble).takeLast(30)
        run(mic, bubble.id, heard) { api.interpretAudio(h, audio, lang, durationMs, heard, voiceMode) }
    }
    fun missed(mic: Mic) { post(ChatBody.Text(t.notUnderstood, true)); speak(mic, t.notUnderstood, lang) }
    private fun applyLocal(c: LocalCommand) {
        when (c) { is LocalCommand.Go -> go(c.tab); is LocalCommand.Language -> setLanguage(c.lang); LocalCommand.SignOut -> signOut() }
    }
    private suspend fun run(mic: Mic, bubbleId: Long? = null, heard: String = "", call: suspend () -> Proposal) {
        busy = true; waitingLong = false; retryHeard = null
        val waiter: Job = scope.launch { delay(3000); waitingLong = true }
        try {
            val p = call()
            val tag = langCode(p.detectedLanguage)
            if (bubbleId != null) chat = chat.map { m ->
                if (m.id != bubbleId) m else { val said = m.body as ChatBody.Said; m.copy(body = said.copy(text = p.transcript.ifBlank { said.text }, lang = tag)) }
            }
            if (bubbleId != null) localCommand(p.transcript)?.let { applyLocal(it); return }
            if ("FALLBACK_RULES" in p.warnings) post(ChatBody.Text(t.fromPhoneWords, true))
            handleProposal(p, mic)
        } catch (e: ApiException) {
            when {
                e.status == 401 -> { store.session = null; me = null }
                e.status >= 500 && bubbleId != null -> { post(ChatBody.Retry(heard)); speak(mic, t.googleSlow, lang) }
                else -> post(ChatBody.Text(e.message, true))
            }
        } catch (e: OfflineException) { post(ChatBody.Retry(heard)) }
        finally { waiter.cancel(); waitingLong = false; busy = false }
    }
    private fun handleProposal(p: Proposal, mic: Mic) {
        val reply = langCode(p.detectedLanguage)?.takeIf { it != "mixed" } ?: lang
        when (p.status) {
            "QUERY_RESULT" -> {
                val rows = p.queryResult ?: emptyList()
                post(ChatBody.Stock(rows))
                if (practicing) { practicing = false; post(ChatBody.Text(t.introDone, false)); speak(mic, t.introDone, lang); notice = null }
                else speak(mic, if (rows.isEmpty()) t.nothingLow else rows.take(4).joinToString(". ") { T(reply).stockSentence(it) }, reply)
            }
            "COUNT_ENTRY" -> if (sheet == null) { post(ChatBody.Text(t.countDue, true)); go(Tab.COUNT) } else applyCounted(p, mic)
            "NAVIGATE" -> when (p.action) {
                "START_COUNT" -> { go(Tab.COUNT); if (sheet == null) startCount() }
                "SHOW_TRANSFERS" -> go(Tab.DELIVERIES)
                "SHOW_CHANGES", "SHOW_ROOM_USE" -> go(Tab.ACTIVITY)
                else -> go(Tab.TODAY)
            }
            "NEEDS_CLARIFICATION" -> {
                if (p.action == "TRANSFER_RECEIPT" || "USE_INCOMING_TRANSFERS" in p.warnings) { go(Tab.DELIVERIES); post(ChatBody.Text(t.deliveries, false)) }
                else { val q = p.clarificationQuestion ?: t.notUnderstood; post(ChatBody.Text(q, true)); speak(mic, q, reply) }
            }
            else -> { post(ChatBody.Text(t.notInApp, true)); speak(mic, t.notInApp, lang) }   // a stock movement: not recorded here
        }
    }
}
