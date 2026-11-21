package app.stockwise.manager.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material.icons.filled.Apartment
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import java.io.File
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.ui.draw.scale
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.stockwise.manager.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Microphone permission + speech, provided by the Activity (fakes in screenshot tests). */
interface Mic {
    val available: Boolean
    fun hasPermission(): Boolean
    fun requestPermission()
    /** record = keep the recording for Google's model instead of the phone's own recognizer. */
    fun start(lang: String, record: Boolean, onInterim: (String) -> Unit, onLevel: (Float) -> Unit, onDone: (String?, Int?) -> Unit)
    /** The last recording (m4a), once; null when cancelled or not recording. */
    fun takeRecording(): ByteArray?
    fun release()
    fun cancel()
    fun say(text: String, lang: String)
    fun hasVoice(lang: String): Boolean
    /** Whether the phone has a network right now. */
    val online: Boolean
}

@Composable
fun ManagerApp(s: AppState, mic: Mic, drawerOpen: Boolean = false) {
    StaffTheme {
        Surface(Modifier.fillMaxSize(), color = C.Linen) {
            when {
                s.booting -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = C.Indigo) }
                s.me == null -> LoginScreen(s)
                else -> Shell(s, mic, drawerOpen)
            }
        }
    }
}

@Composable
fun LoginScreen(s: AppState) {
    val t = s.t
    var code by remember { mutableStateOf(s.store.lastCode) }
    var password by remember { mutableStateOf("") }
    Box(Modifier.fillMaxSize().background(C.Ink).padding(20.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(C.Paper).padding(22.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(C.Indigo), contentAlignment = Alignment.Center) { Text("✓", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.width(12.dp))
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) { Text("Stockwise", style = MaterialTheme.typography.headlineSmall); Spacer(Modifier.width(8.dp)); Tag(t.managerApp, Color.White, C.Indigo) }
                    Text(t.tagline, style = MaterialTheme.typography.bodyMedium)
                }
            }
            LangRow(s)
            OutlinedTextField(code, { code = it.uppercase() }, label = { Text(t.yourCode) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii), textStyle = MaterialTheme.typography.titleLarge)
            OutlinedTextField(password, { password = it }, label = { Text(t.password) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), textStyle = MaterialTheme.typography.titleLarge)
            s.loginError?.let { Banner(it) }
            BigButton(if (s.busy) "…" else t.signIn, { s.login(code, password) }, enabled = !s.busy && code.isNotBlank() && password.isNotBlank())
        }
    }
}

@Composable
fun LangRow(s: AppState) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.5.dp, C.Line, RoundedCornerShape(12.dp))) {
        listOf("gu" to "ગુજરાતી", "hi" to "हिन्दी", "en" to "English").forEach { (l, label) ->
            val on = s.lang == l
            Box(Modifier.weight(1f).height(48.dp).background(if (on) C.Ink else C.Paper).clickable { s.setLanguage(l) }, contentAlignment = Alignment.Center) {
                Text(label, color = if (on) Color.White else C.Ink2, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Shell(s: AppState, mic: Mic, drawerOpen: Boolean = false) {
    val t = s.t
    val drawer = rememberDrawerState(if (drawerOpen) DrawerValue.Open else DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var pickHotel by remember { mutableStateOf(false) }
    val colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = C.IndigoWash, selectedTextColor = C.Indigo, selectedIconColor = C.Indigo)
    ModalNavigationDrawer(drawerState = drawer, drawerContent = {
        ModalDrawerSheet(drawerContainerColor = C.Paper) {
            Column(Modifier.padding(16.dp)) {
                Text(s.me?.displayName ?: "", style = MaterialTheme.typography.titleLarge)
                Text(if (s.me?.role == "OWNER") "Owner" else t.managerApp, style = MaterialTheme.typography.bodyMedium)
            }
            HorizontalDivider(color = C.Line)
            val go = { tab: Tab -> s.go(tab); scope.launch { drawer.close() } }
            @Composable fun item(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, tab: Tab) =
                NavigationDrawerItem(label = { Text(label, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(icon, null) }, selected = s.tab == tab, onClick = { go(tab) }, modifier = Modifier.padding(horizontal = 8.dp), colors = colors)
            item(t.today, Icons.Filled.WbSunny, Tab.TODAY)
            item(t.count, Icons.Filled.FactCheck, Tab.COUNT)
            item(t.stock, Icons.Filled.Inventory2, Tab.STOCK)
            item(t.deliveries, Icons.Filled.LocalShipping, Tab.DELIVERIES)
            item(t.orders, Icons.Filled.ShoppingCart, Tab.ORDERS)
            item(t.suppliers, Icons.Filled.People, Tab.SUPPLIERS)
            item(t.messages + ((s.inbox?.unread ?: 0).takeIf { it > 0 }?.let { " ($it)" } ?: ""), Icons.Filled.Forum, Tab.INBOX)
            item(t.activity, Icons.Filled.History, Tab.ACTIVITY)
            HorizontalDivider(color = C.Line, modifier = Modifier.padding(vertical = 8.dp))
            if (s.hotels.size > 1) {
                NavigationDrawerItem(label = { Text("${if (s.isWarehouse) t.warehouse else t.hotel}: ${s.hotel?.name ?: ""}", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) }, icon = { Icon(Icons.Filled.Apartment, null) }, selected = false, onClick = { pickHotel = !pickHotel }, modifier = Modifier.padding(horizontal = 8.dp))
                if (pickHotel) s.hotels.forEach { h ->
                    NavigationDrawerItem(label = { Text((if (h.isWarehouse) "🏭 " else "") + h.name, fontWeight = if (h.id == s.hotelId) FontWeight.Bold else FontWeight.Normal) }, selected = h.id == s.hotelId, onClick = { s.setHotel(h.id); pickHotel = false; scope.launch { drawer.close() } }, modifier = Modifier.padding(start = 40.dp, end = 8.dp), colors = colors)
                }
            }
            Column(Modifier.padding(horizontal = 16.dp)) { Text(t.language, style = MaterialTheme.typography.bodyMedium); Spacer(Modifier.height(6.dp)); LangRow(s) }
            HorizontalDivider(color = C.Line, modifier = Modifier.padding(vertical = 8.dp))
            NavigationDrawerItem(label = { Text(t.howToUse, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.AutoMirrored.Filled.HelpOutline, null) }, selected = false, onClick = { scope.launch { drawer.close() }; s.showIntro = true }, modifier = Modifier.padding(horizontal = 8.dp))
            item(t.voiceAttempts, Icons.Filled.GraphicEq, Tab.ATTEMPTS)
            Spacer(Modifier.weight(1f))
            HorizontalDivider(color = C.Line)
            NavigationDrawerItem(label = { Text(t.signOut, color = C.Brick, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = C.Brick) }, selected = false,
                onClick = { scope.launch { drawer.close() }; s.signOut() }, modifier = Modifier.padding(8.dp))
        }
    }) {
        Column(Modifier.fillMaxSize().background(C.Linen).systemBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().background(C.Paper).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                val page = s.page
                Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).border(1.5.dp, C.Line, RoundedCornerShape(12.dp)).clickable { if (page != null) s.back() else scope.launch { drawer.open() } }, contentAlignment = Alignment.Center) {
                    if (page != null) Icon(Icons.AutoMirrored.Filled.ArrowBack, t.back, tint = C.Ink) else Icon(Icons.Filled.Menu, "Menu", tint = C.Ink)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    val title = when (s.tab) { Tab.TODAY -> t.today; Tab.COUNT -> t.count; Tab.STOCK -> t.stock; Tab.DELIVERIES -> t.deliveries; Tab.ACTIVITY -> t.activity; Tab.ATTEMPTS -> t.voiceAttempts; Tab.SUPPLIERS -> t.suppliers; Tab.ORDERS -> t.orders; Tab.INBOX -> t.messages }
                    Text(if (page != null) pageTitle(t, page) else title, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text(s.hotel?.name ?: "", style = MaterialTheme.typography.bodyMedium, fontSize = 13.sp, maxLines = 1)
                }
                if (!mic.online) Tag("offline", C.Brick, Color(0xFFFBE9E5))
            }
            HorizontalDivider(color = C.Line)
            Box(Modifier.weight(1f)) {
                val open = s.page
                when {
                    open != null -> PageScreen(s, open)
                    s.chat.isNotEmpty() && s.tab != Tab.COUNT -> ChatScreen(s)
                    s.tab == Tab.TODAY -> TodayScreen(s)
                    s.tab == Tab.COUNT -> CountScreen(s, mic)
                    s.tab == Tab.STOCK -> if (s.isWarehouse) CatalogStockScreen(s) else StockScreen(s)
                    s.tab == Tab.SUPPLIERS -> SuppliersScreen(s)
                    s.tab == Tab.ORDERS -> OrdersScreen(s)
                    s.tab == Tab.INBOX -> InboxScreen(s)
                    s.tab == Tab.DELIVERIES -> DeliveriesScreen(s)
                    s.tab == Tab.ACTIVITY -> ActivityScreen(s)
                    else -> AttemptsScreen(s)
                }
            }
            s.notice?.let { Banner(it.text, it.warn, Modifier.padding(horizontal = 12.dp, vertical = 4.dp).clickable { s.notice = null }) }
            // Forms with their own keyboard hide the voice bar; the order screen keeps it, so items can be spoken in.
            if (s.page == null || s.page is Page.OrderForm || s.page is Page.Chat) VoiceBar(s, mic)
        }
    }
    BackHandler(enabled = s.page != null) { s.back() }
    if (s.showIntro) IntroScreen(s, mic)
}

/** Bottom bar on every screen: hold the mic or type. On the count screen, numbers are counts. */
@Composable
fun VoiceBar(s: AppState, mic: Mic) {
    val t = s.t
    var live by remember { mutableStateOf(false) }
    var startedAt by remember { mutableLongStateOf(0L) }
    var interim by remember { mutableStateOf("") }
    var level by remember { mutableFloatStateOf(0f) }
    // Recordings stop by themselves at 15 s: long holds cost more and understand less.
    LaunchedEffect(live) { if (live) { delay(15_000); if (live) mic.release() } }
    // The + button: take a photo, or choose a photo or PDF already on the phone.
    val ctx = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    var shot by rememberSaveable { mutableStateOf("") }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> val path = shot; shot = ""; if (ok && path.isNotEmpty()) s.attachFile(File(path)) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) s.attachUri(uri) }
    Box {
    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
        DropdownMenuItem(text = { Text("📷  " + t.takePhoto, fontSize = 17.sp) }, onClick = {
            menu = false
            val f = File(ctx.cacheDir, "doc-${System.currentTimeMillis()}.jpg"); shot = f.path
            if (runCatching { camera.launch(FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)) }.isFailure) s.notice = Notice(t.noCamera)
        })
        DropdownMenuItem(text = { Text("📄  " + t.chooseFile, fontSize = 17.sp) }, onClick = { menu = false; runCatching { picker.launch(arrayOf("image/*", "application/pdf")) } })
    }
    Composer(
        onPlus = if (s.page is Page.Chat) null else ({ menu = true }), plusText = t.addFile,
        placeholder = if (s.page is Page.Chat) t.writeMessage else if (s.page is Page.OrderForm) t.sayItems else if (s.voiceMode == "count") t.countHere else t.askHere, slideText = t.slideToCancel, releaseCancelText = t.releaseToCancel,
        live = live, startedAt = startedAt, interim = interim, level = level, busy = s.busy, waitingLong = s.waitingLong,
        stillAsking = t.stillAsking, micAvailable = s.cloudVoice || mic.available,
        draft = s.draft, onDraft = { s.draft = it },
        onText = { s.interpret(it, 0, mic) },
        onStart = {
            if (!mic.hasPermission()) { mic.requestPermission(); return@Composer }
            // No signal: the phone listens by itself (Hindi/English); Google is used only when online.
            val cloud = s.cloudVoice && mic.online
            if (!cloud && !mic.available) { s.notice = Notice(t.offlineVoiceGu); return@Composer }
            s.notice = if (s.cloudVoice && !mic.online) Notice(t.offlineVoice, warn = false) else null
            s.retryHeard = null; interim = ""; level = 0f; startedAt = System.currentTimeMillis(); live = true
            mic.start(s.lang, cloud, { interim = it }, { level = it }) { text, err ->
                live = false; level = 0f
                val ms = System.currentTimeMillis() - startedAt
                val audio = if (cloud) mic.takeRecording() else null
                when {
                    audio != null && audio.size > 2000 && ms >= 600 -> s.interpretAudio(audio, ms, text ?: "", mic)
                    text == null && err == null -> {}                                   // cancelled
                    !text.isNullOrBlank() -> s.interpret(text, ms, mic)
                    else -> s.missed(mic)
                }
            }
        },
        onSend = { mic.release() },
        onCancel = { if (live) { mic.cancel(); live = false } },
        onTap = { s.notice = Notice(if (!mic.hasPermission()) t.micDenied else t.holdHint, warn = false) },
    )
    }
}

/** The conversation as its own screen: what was asked on the right, answers on the left, newest at the bottom; one-tap ways back. */
@Composable
fun ChatScreen(s: AppState) {
    val t = s.t
    val list = rememberLazyListState()
    LaunchedEffect(s.chat.size, s.busy) { list.animateScrollToItem(s.chat.size + 1) }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp), state = list, verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(vertical = 10.dp)) {
            items(s.chat, key = { it.id }) { m -> ChatRow(s, m) }
            if (s.busy) item { AppBubble { Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = C.Indigo); Spacer(Modifier.width(10.dp)); Text(if (s.waitingLong) t.stillAsking else t.understanding, color = C.Ink2) } } }
            item { Spacer(Modifier.height(4.dp)) }
        }
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("☀️ ${t.today}") { s.clearChat(); s.go(Tab.TODAY) }
            Chip("📋 ${t.count}") { s.clearChat(); s.go(Tab.COUNT) }
            Chip("🚚 ${t.deliveries}") { s.clearChat(); s.go(Tab.DELIVERIES) }
            Chip("🛒 ${t.orders}") { s.clearChat(); s.go(Tab.ORDERS) }
            Chip("🕘 ${t.activity}") { s.clearChat(); s.go(Tab.ACTIVITY) }
        }
    }
}

@Composable
fun Chip(text: String, onClick: () -> Unit) {
    Text(text, Modifier.clip(RoundedCornerShape(20.dp)).background(C.Paper).border(1.dp, C.Line, RoundedCornerShape(20.dp)).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 9.dp), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = C.Ink, maxLines = 1)
}

/** On the count screen the latest reply (what was heard, or a problem) sits inline at the top instead of covering the sheet. */
@Composable
fun LatestReply(s: AppState) {
    val m = s.chat.lastOrNull { it.role == Role.APP } ?: return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        ChatRow(s, m)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { Chip("✕ ${s.t.close}") { s.clearChat() } }
    }
}

@Composable
fun ChatRow(s: AppState, m: ChatMessage) {
    val t = s.t
    when (val b = m.body) {
        is ChatBody.Said -> MeBubble(s, b.text, b.spoken, b.lang)
        is ChatBody.Text -> AppBubble(warn = b.warn) { Text(b.text, color = if (b.warn) C.Amber else C.Ink, fontSize = 16.sp) }
        is ChatBody.Retry -> AppBubble(warn = true) {
            Text(t.googleSlow, color = C.Amber, fontWeight = FontWeight.SemiBold)
            if (b.heard.isNotBlank()) Text(b.heard, color = C.Ink2, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton(t.sayAgain, filled = true, color = C.Brick, modifier = Modifier.weight(1f)) { s.notice = Notice(t.holdHint, warn = false) }
                PillButton(t.typeIt, modifier = Modifier.weight(1f)) { s.editSaid(b.heard) }
            }
        }
        is ChatBody.Stock -> AppBubble {
            if (b.rows.isEmpty()) Text(t.nothingLow, fontSize = 16.sp)
            b.rows.take(8).forEach { r ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(r.name, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    if (r.hotelName.isNotBlank() && r.hotelName != s.hotel?.name) Text(" · ${r.hotelName}", fontSize = 13.sp, color = C.Ink2)
                    Spacer(Modifier.weight(1f))
                    Text("${r.store}", fontWeight = FontWeight.ExtraBold, fontSize = 22.sp, color = if (r.low) C.Brick else C.Ink)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (r.staffHeld > 0) Text("${r.staffHeld} ${t.staffCarry}", fontSize = 12.sp, color = C.Ink2)
                    if (r.inTransit > 0) Text("${r.inTransit} ${t.inTransit}", fontSize = 12.sp, color = C.Ink2)
                    if (r.low) Tag(if (r.store == 0) t.outOfStock else t.low, C.Brick, Color(0xFFFBE9E5))
                }
            }
        }
        is ChatBody.Ask -> AskCard(s, m, b)
        is ChatBody.Draft -> DraftCard(s, m, b)
        is ChatBody.Counted -> AppBubble {
            Text(t.heardCount(b.items.size), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
            b.items.forEach { (name, qty) -> Row { Text(name, fontSize = 16.sp); Spacer(Modifier.weight(1f)); Text(qty?.toString() ?: "—", fontWeight = FontWeight.ExtraBold, fontSize = 17.sp, color = C.Mint) } }
        }
    }
}

@Composable
fun MeBubble(s: AppState, text: String, spoken: Boolean, lang: String?) {
    val t = s.t
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Column(Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp)).background(C.Indigo).clickable { s.editSaid(text) }.padding(horizontal = 14.dp, vertical = 10.dp), horizontalAlignment = Alignment.End) {
            Row(verticalAlignment = Alignment.Top) {
                Icon(if (spoken) Icons.Filled.Mic else Icons.Filled.Keyboard, null, tint = Color.White.copy(alpha = 0.75f), modifier = Modifier.size(14.dp).padding(top = 2.dp))
                Spacer(Modifier.width(6.dp))
                Text(text, color = Color.White, fontSize = 17.sp)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                t.langTag(lang)?.let { Tag(it, C.Indigo, Color.White) }
                Text("✎ ${t.tapToFix}", color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp)
            }
        }
    }
}

@Composable
fun AppBubble(warn: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(end = 20.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.size(30.dp).clip(CircleShape).background(C.Indigo), contentAlignment = Alignment.Center) { Text("✓", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f).clip(RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)).background(if (warn) C.MarigoldWash else C.Paper).border(1.dp, if (warn) C.Marigold else C.Line, RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

@Composable
fun Tag(text: String, color: Color = C.Indigo, bg: Color = C.IndigoWash) {
    Text(text, Modifier.clip(RoundedCornerShape(10.dp)).background(bg).padding(horizontal = 8.dp, vertical = 3.dp), color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold, maxLines = 1)
}

@Composable
fun PillButton(text: String, modifier: Modifier = Modifier, filled: Boolean = false, color: Color = C.Mint, enabled: Boolean = true, onClick: () -> Unit) {
    if (filled) Button(onClick, modifier.height(40.dp), enabled = enabled, shape = RoundedCornerShape(20.dp), colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color.White), contentPadding = PaddingValues(horizontal = 10.dp)) { Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
    else OutlinedButton(onClick, modifier.height(40.dp), enabled = enabled, shape = RoundedCornerShape(20.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = if (color == C.Brick) C.Brick else C.Ink), contentPadding = PaddingValues(horizontal = 10.dp)) { Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1) }
}

// ---------- Today ----------

@Composable
fun TodayScreen(s: AppState) {
    val t = s.t
    var asking by remember { mutableStateOf(false) }
    var changing by remember { mutableStateOf<StockRequest?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(t.greeting(s.me?.displayName?.substringBefore(' ') ?: ""), style = MaterialTheme.typography.headlineSmall)
        Text(t.needYou(s.attentionCount), style = MaterialTheme.typography.bodyMedium)
        if (s.attentionCount > 0) Panel {
            Text(t.needsAttention, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
            s.corrections.forEach { c -> AttentionRow(s, "LOW", t.asksToCorrect(c.requestedByName ?: c.displayName ?: ""), c.note, t.review to Tab.ACTIVITY) }
            s.alerts.filter { it.category != "STOCK_REQUEST" }.forEach { a -> AttentionRow(s, a.severity, a.title, a.detail, s.alertAction(a)) }
        }
        (s.inbox?.unread ?: 0).takeIf { it > 0 }?.let { n -> Box(Modifier.clickable { s.go(Tab.INBOX) }) { Banner("💬 " + t.newMessages(n), warn = false) } }
        if (s.isWarehouse) HotelsAskingPanel(s) { changing = it }
        else if (s.hasWarehouse) FromWarehousePanel(s) { asking = true }
        BuyingPanels(s, full = false)
        Text(t.storeNow, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2, modifier = Modifier.padding(top = 4.dp))
        val rows = s.stock.sortedWith(compareBy({ !it.low }, { it.name }))
        rows.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { r -> StockCard(s, r, Modifier.weight(1f)) }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        Spacer(Modifier.height(40.dp))
    }
    if (asking) AskSheet(s) { asking = false }
    changing?.let { SendRequestSheet(s, it) { changing = null } }
}

@Composable
fun AttentionRow(s: AppState, sev: String, title: String, detail: String, action: Pair<String, Tab>?) {
    Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = 6.dp).size(10.dp).clip(CircleShape).background(when (sev) { "HIGH" -> C.Brick; "MEDIUM" -> C.Marigold; else -> C.Ink3 }))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            if (detail.isNotBlank()) Text(detail, fontSize = 12.sp, color = C.Ink2)
        }
        action?.let { (label, tab) -> Box(Modifier.clickable { s.go(tab) }) { Tag(label) } }
    }
}

@Composable
fun StockCard(s: AppState, r: StockRow, modifier: Modifier = Modifier) {
    val th = r.reorderThreshold
    val frac = if (th > 0) (r.store.toFloat() / (th * 2).coerceAtLeast(1)).coerceIn(0f, 1f) else 1f
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(if (r.low) Color(0xFFFBE9E5) else C.Paper).border(1.dp, if (r.low) C.Brick else C.Line, RoundedCornerShape(14.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(s.product(r.productId)?.emoji() ?: "📦", fontSize = 22.sp)
        Text("${r.store}", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, color = if (r.low) C.Brick else C.Ink)
        Text((s.product(r.productId)?.native(s.lang) ?: r.name) + (if (th > 0) " · ${s.t.reorderAt(th)}" else ""), fontSize = 12.sp, color = C.Ink2, maxLines = 2)
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(C.Line)) { Box(Modifier.fillMaxWidth(frac).fillMaxHeight().background(if (r.low) C.Brick else C.Mint)) }
    }
}

// ---------- Stock ----------

@Composable
fun StockScreen(s: AppState) {
    val t = s.t
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        s.stock.forEach { r ->
            Panel(border = if (r.low) C.Brick else C.Line) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(s.product(r.productId)?.emoji() ?: "📦", fontSize = 26.sp)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(s.product(r.productId)?.native(s.lang) ?: r.name, fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (r.staffHeld > 0) Text("${r.staffHeld} ${t.staffCarry}", fontSize = 12.sp, color = C.Ink2)
                            if (r.inTransitIn > 0) Text("${r.inTransitIn} ${t.inTransit}", fontSize = 12.sp, color = C.Ink2)
                            if (r.reorderThreshold > 0) Text(t.reorderAt(r.reorderThreshold), fontSize = 12.sp, color = C.Ink3)
                        }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text("${r.store}", fontSize = 26.sp, fontWeight = FontWeight.ExtraBold, color = if (r.low) C.Brick else C.Ink)
                        if (r.low) Tag(if (r.store == 0) t.outOfStock else t.low, C.Brick, Color(0xFFFBE9E5))
                    }
                }
            }
        }
        Spacer(Modifier.height(40.dp))
    }
}

/** The manager's own last voice attempts: what was heard, in which language, how fast, and what happened. */
@Composable
fun AttemptsScreen(s: AppState) {
    val t = s.t
    fun langName(code: String?) = when (code) { "gu-IN" -> "ગુજરાતી"; "hi-IN" -> "हिंदी"; "en-IN" -> "English"; "mixed" -> t.langTag("mixed") ?: "Mixed"; else -> "–" }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (s.attempts.isEmpty()) Text(t.noAttempts, color = C.Ink2)
        s.attempts.forEach { a ->
            Panel {
                Row(Modifier.fillMaxWidth()) {
                    Text(a.createdAt.substringAfter('T').take(8), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2, modifier = Modifier.weight(1f))
                    val outcome = when { a.status == "FAILED" -> "✗ ${a.errorCode ?: "FAILED"}"; a.fallback != null -> "~ phone words"; a.status == "AMBIGUOUS" -> "? needed help"; else -> "✓ ${a.action ?: ""}" }
                    Text(outcome, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (a.status == "FAILED") C.Brick else C.Ink)
                }
                Text(if (a.transcript.isNullOrEmpty()) "—" else "“${a.transcript}”", fontSize = 16.sp)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Tag(langName(a.language))
                    Text(if (a.inputKind == "text") "⌨️" else "🎤", fontSize = 12.sp)
                    Text(String.format("%.1f s", (a.latencyMs ?: 0) / 1000.0), fontSize = 12.sp, color = C.Ink2)
                }
            }
        }
    }
}

/** Four short cards shown once after the first sign-in, ending with a practice command that changes nothing. */
@Composable
fun IntroScreen(s: AppState, mic: Mic) {
    val t = s.t
    var page by remember { mutableIntStateOf(0) }
    val cards = listOf(Triple(Icons.Filled.Mic, t.introTitle1, t.introBody1), Triple(Icons.Filled.FactCheck, t.introTitle2, t.introBody2),
        Triple(Icons.Filled.TouchApp, t.introTitle3, t.introBody3), Triple(Icons.Filled.AutoAwesome, t.introTitle4, t.introBody4))
    var demo by remember { mutableFloatStateOf(0.3f) }
    LaunchedEffect(page) { while (page == 0) { demo = 0.3f + 0.7f * kotlin.math.abs(kotlin.math.sin(System.currentTimeMillis() / 300.0)).toFloat(); delay(120) } }
    Box(Modifier.fillMaxSize().background(C.Linen).systemBarsPadding().padding(24.dp)) {
        TextButton({ s.finishIntro(false) }, Modifier.align(Alignment.TopEnd)) { Text(t.introSkip, color = C.Ink2, fontWeight = FontWeight.SemiBold) }
        Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Box(Modifier.size(120.dp).clip(CircleShape).background(C.Marigold), contentAlignment = Alignment.Center) { Icon(cards[page].first, null, tint = C.Ink, modifier = Modifier.size(56.dp)) }
            Spacer(Modifier.height(20.dp))
            if (page == 0) { LevelMeter(demo, Modifier.scale(2f)); Spacer(Modifier.height(20.dp)) }
            Text(cards[page].second, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            Text(cards[page].third, fontSize = 18.sp, color = C.Ink2, textAlign = TextAlign.Center)
        }
        Column(Modifier.align(Alignment.BottomCenter), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { repeat(4) { i -> Box(Modifier.size(8.dp).clip(CircleShape).background(if (i == page) C.Indigo else C.Line)) } }
            if (page < 3) BigButton(t.introNext, { page += 1 }) else BigButton(t.introTry, { s.finishIntro(true, mic) }, color = C.Mint)
        }
    }
}
