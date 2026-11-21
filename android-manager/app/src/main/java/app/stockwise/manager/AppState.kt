package app.stockwise.manager

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
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
class AppState(ctx: Context, apiBase: String = BuildConfig.API_BASE) {
    val app: Context = ctx.applicationContext
    val store = Store(app)
    val api = Api(store, apiBase)
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
    // Warehouse requests
    var requests by mutableStateOf<List<StockRequest>>(emptyList())
    var topUp by mutableStateOf<TopUp?>(null)
    var schedules by mutableStateOf<List<RequestSchedule>>(emptyList())

    // Suppliers, orders to suppliers, deliveries
    var home by mutableStateOf<SiteHome?>(null)
    var items by mutableStateOf<List<CatalogItem>>(emptyList())
    var itemQuery by mutableStateOf("")
    var categories by mutableStateOf<List<Category>>(emptyList())
    var suppliers by mutableStateOf<List<Supplier>>(emptyList())
    var supplierQuery by mutableStateOf("")
    var page by mutableStateOf<Page?>(null)
    /** Items found while adding to an order. */
    var found by mutableStateOf<List<CatalogItem>>(emptyList())
    /** Photos taken while checking a delivery (BILL or GOODS), sent once the delivery is saved. */
    var photos by mutableStateOf<List<Pair<String, ByteArray>>>(emptyList())
    /** What the bill photo says for the delivery being checked, and whether it is being read right now. */
    var bill by mutableStateOf<BillRead?>(null)
    var reading by mutableStateOf(false)
    /** Pack sizes found on the web while adding an item (null = not looked up yet). */
    var webOptions by mutableStateOf<List<WebOption>?>(null)
    var lookingUp by mutableStateOf(false)
    /** Team chat: threads with what is new for this person. */
    var inbox by mutableStateOf<Inbox?>(null)
    private var searchJob: Job? = null

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
    /** Signed in at the central warehouse: this screen sends to hotels rather than asking. */
    val isWarehouse get() = hotel?.isWarehouse == true
    val warehouse get() = me?.hotels?.firstOrNull { it.isWarehouse }
    val hasWarehouse get() = me?.warehouseId != null
    val openRequests get() = requests.filter { it.status == "OPEN" }
    val sentRequests get() = requests.filter { it.status == "SENT" }
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
    fun signOut() = scope.launch { api.logout(); me = null; chat = emptyList(); stock = emptyList(); alerts = emptyList(); sheet = null; page = null; home = null }
    fun setLanguage(l: String) { lang = l; store.lang = l; scope.launch { runCatching { api.setLanguage(l) } } }
    fun setHotel(id: String) { hotelId = id; store.hotelId = id; chat = emptyList(); sheet = null; page = null; home = null; scope.launch { loadAll() } }

    // ---------- data ----------
    suspend fun loadAll() {
        val h = hotelId ?: return
        try {
            products = api.products().filter { it.active }
            stock = api.stock(h).items
            alerts = api.alerts(h).items
            corrections = runCatching { api.corrections(h) }.getOrDefault(emptyList())
            countStatus = runCatching { api.countStatus(h).firstOrNull() }.getOrNull()
            if (hasWarehouse) requests = runCatching { api.requests(h) }.getOrDefault(emptyList())
            home = runCatching { api.siteHome(h) }.getOrNull()
            inbox = runCatching { api.inbox() }.getOrNull()
        } catch (e: Exception) { handle(e) }
    }
    fun refresh() = scope.launch { loadAll(); loadTab(tab) }
    suspend fun loadTab(to: Tab) {
        val h = hotelId ?: return
        try {
            when (to) {
                Tab.TODAY -> loadAll()
                Tab.STOCK -> { stock = api.stock(h).items; if (isWarehouse) items = runCatching { api.items(h, itemQuery).items }.getOrDefault(emptyList()) }
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
                    if (hasWarehouse) { requests = runCatching { api.requests(h) }.getOrDefault(emptyList()); if (!isWarehouse) schedules = runCatching { api.schedules(h) }.getOrDefault(emptyList()) }
                }
                Tab.ACTIVITY -> { events = api.activity(h).items; corrections = runCatching { api.corrections(h) }.getOrDefault(emptyList()) }
                Tab.ATTEMPTS -> attempts = runCatching { api.voiceAttempts().attempts }.getOrDefault(emptyList())
                Tab.SUPPLIERS -> { suppliers = api.suppliers(supplierQuery); loadCategories() }
                Tab.ORDERS -> home = api.siteHome(h)
                Tab.INBOX -> inbox = api.inbox()
            }
        } catch (e: Exception) { handle(e) }
    }
    fun go(to: Tab) { if (to != tab) chat = emptyList(); page = null; tab = to; scope.launch { loadTab(to) } }
    private fun handle(e: Exception) {
        when (e) {
            is ApiException -> if (e.status == 401) { store.session = null; me = null } else notice = Notice(e.message)
            is OfflineException -> notice = Notice(t.offlineLogin)
            else -> notice = Notice(e.message ?: "Error")
        }
    }
    fun alertAction(a: Alert): Pair<String, Tab>? = when {
        a.category == "LOW_STOCK_ASK_WAREHOUSE" -> t.askWarehouse to Tab.DELIVERIES
        a.category == "LOW_STOCK_REQUESTED" -> t.requestSent to Tab.DELIVERIES
        a.category == "STOCK_REQUEST" -> t.send to Tab.DELIVERIES
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

    // ---------- warehouse requests ----------
    /** Load what this hotel would ask for to get back to par, so the request sheet opens pre-filled. */
    fun loadTopUp() = scope.launch { val h = hotelId ?: return@launch; topUp = runCatching { api.topUp(h) }.getOrNull() }
    fun askWarehouse(quantities: Map<String, Int>, note: String? = null, onDone: (() -> Unit)? = null) = scope.launch {
        val h = hotelId ?: return@launch
        val lines = quantities.filter { it.value > 0 }.map { DispatchLine(it.key, it.value) }
        if (lines.isEmpty()) return@launch
        try { api.createRequest(h, lines, note); notice = Notice(t.requestSent, warn = false); loadAll(); loadTab(tab); onDone?.invoke() } catch (e: Exception) { handle(e) }
    }
    fun sendRequest(r: StockRequest, quantities: Map<String, Int>? = null) = scope.launch {
        val lines = quantities?.filter { it.value > 0 }?.map { DispatchLine(it.key, it.value) }
        try { api.dispatchRequest(r.id, lines, UUID.randomUUID().toString()); notice = Notice(t.sent2(r.hotel.name), warn = false); loadAll(); loadTab(tab) } catch (e: Exception) { handle(e) }
    }
    fun declineRequest(r: StockRequest) = scope.launch { try { api.declineRequest(r.id); loadAll(); loadTab(tab) } catch (e: Exception) { handle(e) } }
    fun setAutoAsk(on: Boolean) = scope.launch {
        val h = hotelId ?: return@launch
        try {
            if (on) api.addSchedule(h, 1, 7) else schedules.forEach { api.deleteSchedule(it.id) }
            schedules = api.schedules(h)
        } catch (e: Exception) { handle(e) }
    }
    /** The confirm button on a spoken request. */
    fun confirmAsk(m: ChatMessage) {
        val b = m.body as? ChatBody.Ask ?: return
        askWarehouse(b.lines.associate { it.first.id to it.second }) { chat = chat.map { if (it.id == m.id) it.copy(body = b.copy(sent = true)) else it } }
    }

    // ---------- team chat ----------
    private fun chatPage() = page as? Page.Chat
    fun openThread(siteId: String) = scope.launch { try { page = Page.Chat(api.messages(siteId)); inbox = runCatching { api.inbox() }.getOrNull() } catch (e: Exception) { handle(e) } }
    private suspend fun reloadThread() { val c = chatPage() ?: return; val fresh = api.messages(c.thread.siteId); if (chatPage()?.thread?.siteId == fresh.siteId) page = Page.Chat(fresh) }
    fun sendMessage(text: String) = scope.launch {
        val c = chatPage() ?: return@launch
        if (text.isBlank()) return@launch
        try { api.postMessage(c.thread.siteId, text.trim()); reloadThread() } catch (e: Exception) { handle(e) }
    }
    /** The buttons on a request card in the chat: the warehouse packs and sends it, or says no. */
    fun chatSend(m: Msg) = scope.launch { val id = m.refId ?: return@launch; try { api.dispatchRequest(id, null, UUID.randomUUID().toString()); reloadThread(); loadAll() } catch (e: Exception) { handle(e) } }
    fun chatDecline(m: Msg) = scope.launch { val id = m.refId ?: return@launch; try { api.declineRequest(id); reloadThread(); loadAll() } catch (e: Exception) { handle(e) } }
    /** While the app is open, look for new messages once a minute. */
    private val poll = scope.launch {
        while (true) {
            delay(60_000)
            if (me != null) try { inbox = api.inbox(); reloadThread() } catch (e: ApiException) { } catch (e: OfflineException) { }
        }
    }

    // ---------- suppliers ----------
    private suspend fun loadCategories() { if (categories.isEmpty()) categories = runCatching { api.categories() }.getOrDefault(emptyList()) }
    /** Runs the newest search only; an older one still on its way is dropped. */
    private fun search(block: suspend () -> Unit) {
        searchJob?.cancel()
        searchJob = scope.launch { try { block() } catch (e: ApiException) { handle(e) } catch (e: OfflineException) { handle(e) } }
    }
    fun searchSuppliers(q: String) { supplierQuery = q; search { suppliers = api.suppliers(q) } }
    fun searchItems(q: String) { itemQuery = q; val h = hotelId ?: return; search { items = api.items(h, q).items } }
    fun openSupplier(id: String) = scope.launch { try { page = Page.SupplierCard(api.supplier(id)); loadCategories() } catch (e: Exception) { handle(e) } }
    fun newSupplier() { page = Page.SupplierAdd; scope.launch { loadCategories() } }
    fun saveSupplier(name: String, phone: String, categoryIds: List<String>) = scope.launch {
        try {
            val c = api.createSupplier(SupplierBody(name.trim(), phone.trim().ifBlank { null }, categoryIds = categoryIds))
            suppliers = api.suppliers(supplierQuery); page = Page.SupplierCard(api.supplier(c.id))
        } catch (e: Exception) { handle(e) }
    }
    fun toggleFavourite(sup: Supplier) = scope.launch {
        try { api.patchSupplier(sup.id, SupplierBody(favourite = !sup.favourite)); page = Page.SupplierCard(api.supplier(sup.id)); suppliers = api.suppliers(supplierQuery) } catch (e: Exception) { handle(e) }
    }
    fun addSupplierCategory(sup: Supplier, categoryId: String) = scope.launch {
        try { api.setSupplierCategory(sup.id, categoryId, true, emptyList()); page = Page.SupplierCard(api.supplier(sup.id)) } catch (e: Exception) { handle(e) }
    }
    fun openSupplierItems(sup: Supplier, cat: SupplierCat) = scope.launch { try { page = Page.SupplierItems(sup, cat, api.supplierItems(sup.id, cat.id)) } catch (e: Exception) { handle(e) } }
    fun saveSupplierItems(sup: Supplier, cat: SupplierCat, all: Boolean, ids: List<String>) = scope.launch {
        try { api.setSupplierCategory(sup.id, cat.id, all, if (all) emptyList() else ids); notice = Notice(t.saved, warn = false); page = Page.SupplierCard(api.supplier(sup.id)) } catch (e: Exception) { handle(e) }
    }
    fun back() { val p = page; page = if (p is Page.SupplierItems) Page.SupplierCard(p.supplier) else null }

    // The phone's own dialler and WhatsApp do the talking to suppliers; the app only opens them.
    private fun launch(i: Intent): Boolean = runCatching { app.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
    fun call(phone: String?) {
        val d = (phone ?: "").filter { it.isDigit() || it == '+' }
        if (d.isEmpty() || !launch(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$d")))) notice = Notice(t.noPhone)
    }
    fun whatsapp(phone: String?, text: String = "") {
        var d = (phone ?: "").filter { it.isDigit() }
        if (d.length == 10) d = "91$d"
        if (d.isEmpty()) { notice = Notice(t.noPhone); return }
        if (!launch(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$d" + if (text.isNotBlank()) "?text=" + Uri.encode(text) else "")))) notice = Notice(t.noWhatsapp)
    }

    // ---------- orders to suppliers ----------
    private fun form() = page as? Page.OrderForm
    /** Opens the order screen. With a supplier it comes pre-filled with what is running low; `keep` are lines already chosen (a spoken draft being edited). */
    fun startOrder(sup: NamedRef?, keep: List<FormLine> = emptyList(), source: String = "FORM") = scope.launch {
        val h = hotelId ?: return@launch
        found = emptyList()
        if (sup == null) {
            page = Page.OrderForm(null, keep, source = source)
            if (suppliers.isEmpty()) suppliers = runCatching { api.suppliers() }.getOrDefault(emptyList())
            return@launch
        }
        try {
            val low = api.suggest(h, sup.id).map { FormLine(it.productId, it.name, it.unit, it.store, it.quantity, it.lastQuantity, if (keep.isEmpty()) it.quantity else 0) }
            page = Page.OrderForm(sup, keep + low.filter { x -> keep.none { it.productId == x.productId } }, source = source)
        } catch (e: Exception) { handle(e) }
    }
    fun setQty(productId: String, qty: Int) { val f = form() ?: return; page = f.copy(lines = f.lines.map { if (it.productId == productId) it.copy(qty = qty.coerceIn(0, 1_000_000)) else it }) }
    fun sameAsLast() { val f = form() ?: return; page = f.copy(lines = f.lines.map { it.copy(qty = it.last ?: it.qty) }) }
    fun fillUp() { val f = form() ?: return; page = f.copy(lines = f.lines.map { if (it.fill > 0) it.copy(qty = it.fill) else it }) }
    fun clearQty() { val f = form() ?: return; page = f.copy(lines = f.lines.map { it.copy(qty = 0) }) }
    fun findItems(q: String) {
        val h = hotelId ?: return
        if (q.trim().length < 2) { searchJob?.cancel(); found = emptyList(); return }
        search { found = api.items(h, q).items }
    }
    fun addOrderItem(i: CatalogItem) {
        val f = form() ?: return
        found = emptyList()
        if (f.lines.none { it.productId == i.id }) page = f.copy(lines = listOf(FormLine(i.id, i.name, i.unit, i.store, (i.par - i.store).coerceAtLeast(0))) + f.lines)
    }
    /** Saves the order as a draft and shows the message the supplier will get. Nothing is sent yet. */
    fun saveOrder() = scope.launch {
        val h = hotelId ?: return@launch
        val f = form() ?: return@launch
        val sup = f.supplier ?: return@launch
        val lines = f.lines.filter { it.qty > 0 }.map { DispatchLine(it.productId, it.qty) }
        if (lines.isEmpty()) { notice = Notice(t.addOneItem); return@launch }
        try {
            val id = f.orderId?.also { api.patchOrder(it, sup.id, lines) } ?: api.createOrder(h, sup.id, lines, f.source).id
            page = Page.Message(api.order(id)); home = runCatching { api.siteHome(h) }.getOrNull()
        } catch (e: Exception) { handle(e) }
    }
    fun openOrder(o: OrderSummary) = scope.launch {
        try { val full = api.order(o.id); photos = emptyList(); bill = null; page = if (full.status == "DRAFT") Page.Message(full) else Page.Check(full) } catch (e: Exception) { handle(e) }
    }
    fun editOrder(o: Order) { found = emptyList(); page = Page.OrderForm(NamedRef(o.supplier.id, o.supplier.name), o.lines.map { FormLine(it.productId, it.name, it.unit, it.store, qty = it.quantity) }, o.id) }
    /** Marks the order as sent and opens WhatsApp with the message ready (or the dialler). */
    fun sendOrder(o: Order, byCall: Boolean) = scope.launch {
        val h = hotelId ?: return@launch
        try {
            val sent = api.sendOrder(o.id)
            page = null; chat = emptyList(); tab = Tab.ORDERS; notice = Notice(t.orderSent(sent.supplier.name), warn = false)
            if (byCall) call(sent.supplier.phone) else whatsapp(sent.supplier.phone, sent.message)
            home = runCatching { api.siteHome(h) }.getOrNull()
        } catch (e: Exception) { handle(e) }
    }

    // ---------- checking a delivery ----------
    /** Keeps a phone photo as a small JPEG (long side 1600 px) so it uploads on a weak signal. */
    private fun shrink(raw: ByteArray): ByteArray? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
        val bmp = BitmapFactory.decodeByteArray(raw, 0, raw.size, BitmapFactory.Options().apply { inSampleSize = sample })
        val out = ByteArrayOutputStream()
        if (bmp != null && bmp.compress(Bitmap.CompressFormat.JPEG, 80, out)) out.toByteArray() else null
    }.getOrNull()

    /** The + button: a photo just taken, or a photo or PDF chosen from the phone. */
    fun attachFile(file: File) = scope.launch {
        val jpeg = withContext(Dispatchers.IO) { runCatching { shrink(file.readBytes()) }.getOrNull() }
        runCatching { file.delete() }
        if (jpeg != null) attach(jpeg, "image/jpeg") else notice = Notice(t.noCamera)
    }
    fun attachUri(uri: Uri) = scope.launch {
        val pdf = app.contentResolver.getType(uri) == "application/pdf"
        val bytes = withContext(Dispatchers.IO) { runCatching { app.contentResolver.openInputStream(uri)?.use { it.readBytes() }?.let { if (pdf) it else shrink(it) } }.getOrNull() }
        when {
            bytes == null -> notice = Notice(t.fileNotOpened)
            bytes.size > 4_000_000 -> notice = Notice(t.fileTooBig)
            else -> attach(bytes, if (pdf) "application/pdf" else "image/jpeg")
        }
    }
    /**
     * What happens to the file depends on where you are: while checking a delivery it is that delivery's bill; on the order
     * screen its items are added to the order; anywhere else the app works out whether it is a bill or a list. Nothing is saved until you confirm.
     */
    fun attach(bytes: ByteArray, mime: String) = scope.launch {
        val h = hotelId ?: return@launch
        notice = null
        val image = mime != "application/pdf"
        if (page is Page.Check) { if (image) photos = (photos + ("BILL" to bytes)).takeLast(6); readBill(bytes, mime); return@launch }
        val f = form()
        if (f == null) { page = null; post(ChatBody.Said(if (image) "📷 " + t.aPhoto else "📄 PDF", false), Role.ME) }
        busy = true
        val r = try { api.readDocument(h, bytes, mime) } catch (e: ApiException) { handle(e); null } catch (e: OfflineException) { handle(e); null }
        busy = false
        if (r == null) return@launch
        val d = r.draft
        when {
            f != null -> {
                val got = d?.let { draftLines(it) } ?: emptyList()
                val cur = form()
                if (got.isEmpty() || cur == null) notice = Notice(t.docNothing)
                else {
                    val merged = cur.lines.map { l -> got.firstOrNull { it.productId == l.productId && it.qty > 0 }?.let { g -> l.copy(qty = g.qty) } ?: l }
                    page = cur.copy(lines = got.filter { g -> cur.lines.none { it.productId == g.productId } } + merged)
                    notice = Notice(got.joinToString(", ") { "${it.name} ${it.qty}" }, warn = false)
                }
            }
            r.type == "DELIVERY" && r.orderId != null && r.bill != null -> try {
                val full = api.order(r.orderId)
                photos = if (image) listOf("BILL" to bytes) else emptyList()
                bill = r.bill; chat = emptyList(); page = Page.Check(full)
            } catch (e: Exception) { handle(e) }
            r.type == "ORDER" && d != null -> post(ChatBody.Draft(d))
            else -> post(ChatBody.Text(r.summary?.takeIf { it.isNotBlank() }?.let { t.docSaw(it) } ?: t.docNothing))
        }
    }

    fun addPhoto(kind: String, file: File) = scope.launch {
        val jpeg = withContext(Dispatchers.IO) { runCatching { shrink(file.readBytes()) }.getOrNull() }
        runCatching { file.delete() }
        if (jpeg != null) { photos = (photos + (kind to jpeg)).takeLast(6); if (kind == "BILL") readBill(jpeg) } else notice = Notice(t.noCamera)
    }
    /** Reads the bill photo against the order so the numbers come pre-filled. If it cannot be read, counting by hand works as before. */
    fun readBill(jpeg: ByteArray, mime: String = "image/jpeg") = scope.launch {
        val o = (page as? Page.Check)?.order ?: return@launch
        reading = true
        val r = try { api.readBill(o.id, jpeg, mime) } catch (e: ApiException) { null } catch (e: OfflineException) { null }
        reading = false
        if (r?.read == true && r.lines.isNotEmpty()) bill = r else notice = Notice(t.billNotRead, warn = false)
    }
    fun submitCheck(o: Order, lines: List<DeliveryLineBody>) = scope.launch {
        if (lines.isEmpty()) return@launch
        busy = true
        try {
            val r = api.checkIn(o.id, lines, UUID.randomUUID().toString())
            photos.forEach { (kind, jpeg) -> runCatching { api.uploadPhoto(r.deliveryId, kind, jpeg) } }
            photos = emptyList(); page = null
            notice = Notice(t.deliveryChecked(r.flags.count { it.kind == "SHORT" }, r.flags.count { it.kind == "SENT_BACK" }, r.flags.count { it.kind == "PRICE_UP" }), warn = r.flags.isNotEmpty())
            loadAll(); loadTab(tab)
        } catch (e: Exception) { handle(e) }
        busy = false
    }

    // ---------- items ----------
    fun newItem() { page = Page.AddItem; webOptions = null; scope.launch { loadCategories() } }
    fun lookupItem(q: String) = scope.launch {
        lookingUp = true
        webOptions = try { api.lookup(q.trim()).options } catch (e: ApiException) { emptyList() } catch (e: OfflineException) { emptyList() }
        lookingUp = false
    }
    private fun wantsCheck(text: String) = Regex("(check|चेक|जांच|जाँच|ચેક|તપાસ).{0,20}(delivery|डिलीवरी|ડિલિવરી)|(delivery|डिलीवरी|ડિલિવરી).{0,20}(check|aa ?ga|aayi|aavi|आ गई|आ गया|આવી|चेक|ચેક)").containsMatchIn(text.lowercase())
    /** "Check the delivery": straight to the one that is due, or to the list when there are several. */
    private fun goCheck() { val due = home?.deliveriesDue ?: emptyList(); chat = emptyList(); if (due.size == 1) openOrder(due[0]) else go(Tab.ORDERS) }
    fun addItem(name: String, unit: String, categoryId: String?) = scope.launch {
        try {
            val c = api.createItem(name.trim(), unit, categoryId)
            notice = Notice(if (c.existed) t.alreadyInList else t.saved, warn = false); page = null; itemQuery = name.trim(); loadTab(Tab.STOCK)
        } catch (e: Exception) { handle(e) }
    }

    // ---------- an order spoken in one go ----------
    private fun wantsOrder(text: String): Boolean {
        val s = text.lowercase()
        if (Regex("warehouse|godown|गोदाम|ગોડાઉન").containsMatchIn(s)) return false
        return tab == Tab.ORDERS || Regex("\\border|ऑर्डर|ओर्डर|ઓર્ડર").containsMatchIn(s)
    }
    private fun draftLines(d: OrderDraft) = d.lines.mapNotNull { l -> l.match?.let { m -> FormLine(m.productId, m.name, m.unit, qty = l.quantity ?: 0) } }
    /** Matches the spoken supplier and items and shows a draft with Discard / Edit / Confirm. Saves nothing. */
    private suspend fun tryDraft(text: String, mic: Mic): Boolean {
        val h = hotelId ?: return false
        val d = try { api.draftOrder(h, text) } catch (e: ApiException) { return false } catch (e: OfflineException) { return false }
        if (d.lines.none { it.match != null } || (d.supplier == null && tab != Tab.ORDERS)) return false
        post(ChatBody.Draft(d))
        speak(mic, if (d.ready) t.draftReady(d.supplier?.name ?: "", d.lines.size) else t.draftCheck, lang)
        return true
    }
    private fun markDraft(m: ChatMessage, state: String) {
        val b = m.body as? ChatBody.Draft ?: return
        chat = chat.map { if (it.id == m.id) it.copy(body = b.copy(state = state)) else it }
    }
    fun discardDraft(m: ChatMessage) { markDraft(m, "DISCARDED") }
    fun editDraft(m: ChatMessage) { val b = m.body as? ChatBody.Draft ?: return; markDraft(m, "EDITED"); startOrder(b.draft.supplier, draftLines(b.draft), "VOICE") }
    fun confirmDraft(m: ChatMessage) = scope.launch {
        val h = hotelId ?: return@launch
        val b = m.body as? ChatBody.Draft ?: return@launch
        val sup = b.draft.supplier ?: return@launch
        try {
            val c = api.createOrder(h, sup.id, draftLines(b.draft).filter { it.qty > 0 }.map { DispatchLine(it.productId, it.qty) }, "VOICE")
            markDraft(m, "CONFIRMED"); page = Page.Message(api.order(c.id)); home = runCatching { api.siteHome(h) }.getOrNull()
        } catch (e: Exception) { handle(e) }
    }
    /** On the order screen, speech adds to the order in hand: "20 kilo paneer, 5 butter". */
    private suspend fun speakInto(f: Page.OrderForm, text: String) {
        val h = hotelId ?: return
        if (text.isBlank()) { notice = Notice(t.notUnderstood); return }
        try {
            val got = draftLines(api.draftOrder(h, text, f.supplier?.id))
            val cur = form()
            if (got.isEmpty() || cur == null) { notice = Notice(t.notUnderstood); return }
            val merged = cur.lines.map { l -> got.firstOrNull { it.productId == l.productId && it.qty > 0 }?.let { g -> l.copy(qty = g.qty) } ?: l }
            page = cur.copy(lines = got.filter { g -> cur.lines.none { it.productId == g.productId } } + merged)
            notice = Notice(got.joinToString(", ") { "${it.name} ${it.qty}" }, warn = false)
        } catch (e: ApiException) { handle(e) } catch (e: OfflineException) { handle(e) }
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
        if (chatPage() != null) { sendMessage(text); return@launch }
        form()?.let { busy = true; speakInto(it, text); busy = false; return@launch }
        post(ChatBody.Said(text, durationMs > 0), Role.ME)
        localCommand(text)?.let { applyLocal(it); return@launch }
        if (wantsCheck(text)) { goCheck(); return@launch }
        if (wantsOrder(text)) { busy = true; val drafted = tryDraft(text, mic); busy = false; if (drafted) return@launch }
        ask(mic) { api.interpret(h, text, lang, durationMs, voiceMode) }
    }
    fun interpretAudio(audio: ByteArray, durationMs: Long, heard: String, mic: Mic) = scope.launch {
        val h = hotelId ?: return@launch
        notice = null
        if (chatPage() != null) {
            // A spoken message is sent as the words that were heard.
            busy = true
            try { sendMessage(api.interpretAudio(h, audio, lang, durationMs, heard).transcript.ifBlank { heard }) } catch (e: ApiException) { handle(e) } catch (e: OfflineException) { handle(e) }
            busy = false; return@launch
        }
        form()?.let { f ->
            busy = true
            try { speakInto(f, api.interpretAudio(h, audio, lang, durationMs, heard).transcript.ifBlank { heard }) } catch (e: ApiException) { handle(e) } catch (e: OfflineException) { handle(e) }
            busy = false; return@launch
        }
        val bubble = ChatMessage(Role.ME, ChatBody.Said(if (heard.isBlank()) "…" else heard, true))
        chat = (chat + bubble).takeLast(30)
        ask(mic, bubble.id, heard) { api.interpretAudio(h, audio, lang, durationMs, heard, voiceMode) }
    }
    fun missed(mic: Mic) { post(ChatBody.Text(t.notUnderstood, true)); speak(mic, t.notUnderstood, lang) }
    private fun applyLocal(c: LocalCommand) {
        when (c) { is LocalCommand.Go -> go(c.tab); is LocalCommand.Language -> setLanguage(c.lang); LocalCommand.SignOut -> signOut() }
    }
    private suspend fun ask(mic: Mic, bubbleId: Long? = null, heard: String = "", call: suspend () -> Proposal) {
        busy = true; waitingLong = false; retryHeard = null
        val waiter: Job = scope.launch { delay(3000); waitingLong = true }
        try {
            val p = call()
            val tag = langCode(p.detectedLanguage)
            val target = bubbleId ?: chat.lastOrNull { it.role == Role.ME }?.id
            if (target != null) chat = chat.map { m ->
                if (m.id != target) m else { val said = m.body as ChatBody.Said; m.copy(body = said.copy(text = if (bubbleId != null) p.transcript.ifBlank { said.text } else said.text, lang = tag)) }
            }
            if (bubbleId != null) localCommand(p.transcript)?.let { applyLocal(it); return }
            if (bubbleId != null && wantsCheck(p.transcript)) { goCheck(); return }
            if (bubbleId != null && wantsOrder(p.transcript) && tryDraft(p.transcript, mic)) return
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
            "READY_TO_CONFIRM" -> when (p.action) {
                "REQUEST_FROM_WAREHOUSE" -> {
                    val lines = p.lines.mapNotNull { l -> product(l.productId)?.let { it to (l.quantity ?: 0) } }.filter { it.second > 0 }
                    when {
                        isWarehouse || !hasWarehouse -> { post(ChatBody.Text(t.notInApp, true)); speak(mic, t.notInApp, lang) }
                        lines.isEmpty() -> { post(ChatBody.Text(t.notUnderstood, true)); speak(mic, t.notUnderstood, reply) }
                        else -> { post(ChatBody.Ask(lines)); speak(mic, t.askConfirm(lines.joinToString(", ") { "${it.second} ${it.first.name}" }), reply) }
                    }
                }
                "TRANSFER_DISPATCH" -> if (isWarehouse) { go(Tab.DELIVERIES); post(ChatBody.Text(t.sendFromList, false)); speak(mic, t.sendFromList, reply) } else { post(ChatBody.Text(t.notInApp, true)); speak(mic, t.notInApp, lang) }
                else -> { post(ChatBody.Text(t.notInApp, true)); speak(mic, t.notInApp, lang) }   // a stock movement: not recorded here
            }
            else -> { post(ChatBody.Text(t.notInApp, true)); speak(mic, t.notInApp, lang) }
        }
    }
}
