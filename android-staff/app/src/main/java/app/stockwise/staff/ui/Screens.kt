package app.stockwise.staff.ui

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
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.ui.draw.scale
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.Check
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
import app.stockwise.staff.*
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
fun StaffApp(s: AppState, mic: Mic, drawerOpen: Boolean = false) {
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
    var pin by remember { mutableStateOf("") }
    Box(Modifier.fillMaxSize().background(C.Ink).padding(20.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(C.Paper).padding(22.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(C.Indigo), contentAlignment = Alignment.Center) { Text("✓", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.width(12.dp))
                Column { Text("Stockwise", style = MaterialTheme.typography.headlineSmall); Text(t.tagline, style = MaterialTheme.typography.bodyMedium) }
            }
            LangRow(s)
            OutlinedTextField(code, { code = it.uppercase() }, label = { Text(t.yourCode) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii), textStyle = MaterialTheme.typography.titleLarge)
            OutlinedTextField(pin, { v -> pin = v.filter { it.isDigit() }.take(8) }, label = { Text(t.passcode) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), textStyle = MaterialTheme.typography.titleLarge)
            s.loginError?.let { Banner(it) }
            BigButton(if (s.busy) "…" else t.signIn, { s.login(code, pin) }, enabled = !s.busy && code.isNotBlank() && pin.length >= 4)
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
    ModalNavigationDrawer(drawerState = drawer, drawerContent = {
        ModalDrawerSheet(drawerContainerColor = C.Paper) {
            Column(Modifier.padding(16.dp)) {
                Text(s.me?.displayName ?: "", style = MaterialTheme.typography.titleLarge)
                Text(s.hotel?.name ?: "", style = MaterialTheme.typography.bodyMedium)
            }
            HorizontalDivider(color = C.Line)
            val go = { tab: Tab -> s.flow = null; s.tab = tab; if (tab == Tab.HISTORY) s.loadHistory(); if (tab == Tab.BAG) s.refresh(); if (tab == Tab.ATTEMPTS) s.loadAttempts(); scope.launch { drawer.close() } }
            NavigationDrawerItem(label = { Text(t.home, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.Filled.Home, null) }, selected = s.tab == Tab.HOME && s.flow == null, onClick = { go(Tab.HOME) }, modifier = Modifier.padding(horizontal = 8.dp), colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = C.IndigoWash, selectedTextColor = C.Indigo, selectedIconColor = C.Indigo))
            NavigationDrawerItem(label = { Text(t.myBag, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.Filled.Inventory2, null) }, selected = s.tab == Tab.BAG && s.flow == null, onClick = { go(Tab.BAG) }, modifier = Modifier.padding(horizontal = 8.dp), colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = C.IndigoWash, selectedTextColor = C.Indigo, selectedIconColor = C.Indigo))
            NavigationDrawerItem(label = { Text(t.history, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.Filled.History, null) }, selected = s.tab == Tab.HISTORY && s.flow == null, onClick = { go(Tab.HISTORY) }, modifier = Modifier.padding(horizontal = 8.dp), colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = C.IndigoWash, selectedTextColor = C.Indigo, selectedIconColor = C.Indigo))
            HorizontalDivider(color = C.Line, modifier = Modifier.padding(vertical = 8.dp))
            NavigationDrawerItem(label = { Text(t.howToUse, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.AutoMirrored.Filled.HelpOutline, null) }, selected = false, onClick = { scope.launch { drawer.close() }; s.showIntro = true }, modifier = Modifier.padding(horizontal = 8.dp))
            NavigationDrawerItem(label = { Text(t.voiceAttempts, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.Filled.GraphicEq, null) }, selected = s.tab == Tab.ATTEMPTS && s.flow == null, onClick = { go(Tab.ATTEMPTS) }, modifier = Modifier.padding(horizontal = 8.dp), colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = C.IndigoWash, selectedTextColor = C.Indigo, selectedIconColor = C.Indigo))
            HorizontalDivider(color = C.Line, modifier = Modifier.padding(vertical = 8.dp))
            Column(Modifier.padding(horizontal = 16.dp)) { Text(t.language, style = MaterialTheme.typography.bodyMedium); Spacer(Modifier.height(6.dp)); LangRow(s) }
            Spacer(Modifier.weight(1f))
            HorizontalDivider(color = C.Line)
            NavigationDrawerItem(label = { Text(t.signOut, color = C.Brick, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = C.Brick) }, selected = false,
                onClick = { scope.launch { drawer.close() }; s.signOut() }, modifier = Modifier.padding(8.dp))
        }
    }) {
        Column(Modifier.fillMaxSize().background(C.Linen).systemBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().background(C.Paper).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).border(1.5.dp, C.Line, RoundedCornerShape(12.dp)).clickable { scope.launch { drawer.open() } }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Menu, "Menu", tint = C.Ink)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    val title = s.flow?.let { t.act(it.kind).first } ?: when (s.tab) { Tab.HOME -> s.hotel?.name ?: ""; Tab.BAG -> t.myBag; Tab.HISTORY -> t.history; Tab.ATTEMPTS -> t.voiceAttempts }
                    Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text("${s.me?.displayName ?: ""} · ${s.hotel?.name ?: ""}", style = MaterialTheme.typography.bodyMedium, fontSize = 13.sp, maxLines = 1)
                }
            }
            HorizontalDivider(color = C.Line)
            Box(Modifier.weight(1f)) {
                val f = s.flow
                when {
                    f != null -> FlowScreen(s, f, mic)
                    s.tab == Tab.HOME -> HomeScreen(s, mic)
                    s.tab == Tab.BAG -> BagScreen(s)
                    s.tab == Tab.ATTEMPTS -> AttemptsScreen(s)
                    else -> HistoryScreen(s)
                }
            }
            if (s.flow == null && s.tab == Tab.HOME) VoiceBar(s, mic)
        }
    }
    if (s.showIntro) IntroScreen(s, mic)
}

/** Bottom bar on the home screen: hold the mic or type. */
@Composable
fun VoiceBar(s: AppState, mic: Mic) {
    val t = s.t
    var live by remember { mutableStateOf(false) }
    var startedAt by remember { mutableLongStateOf(0L) }
    var interim by remember { mutableStateOf("") }
    var level by remember { mutableFloatStateOf(0f) }
    // Recordings stop by themselves at 15 s: long holds cost more and understand less.
    LaunchedEffect(live) { if (live) { delay(15_000); if (live) mic.release() } }
    Composer(
        placeholder = t.typeHere, slideText = t.slideToCancel, releaseCancelText = t.releaseToCancel,
        live = live, startedAt = startedAt, interim = interim, level = level, busy = s.busy, waitingLong = s.waitingLong,
        stillAsking = t.stillAsking, micAvailable = s.cloudVoice || mic.available,
        draft = s.draft, onDraft = { s.draft = it },
        onText = { s.interpret(it, 0) },
        onStart = {
            if (!mic.hasPermission()) { mic.requestPermission(); return@Composer }
            // No signal: the phone listens by itself (Hindi/English); Google is used only when online.
            val cloud = s.cloudVoice && mic.online
            if (!cloud && !mic.available) { s.notice = Notice(t.noVoice); s.nudgeTap = true; return@Composer }
            s.notice = if (s.cloudVoice && !mic.online) Notice(t.offlineVoice, warn = false) else null
            s.answer = null; s.retryHeard = null; interim = ""; level = 0f; startedAt = System.currentTimeMillis(); live = true
            mic.start(s.lang, cloud, { interim = it }, { level = it }) { text, err ->
                live = false; level = 0f
                val ms = System.currentTimeMillis() - startedAt
                val audio = if (cloud) mic.takeRecording() else null
                when {
                    audio != null && audio.size > 2000 && ms >= 600 -> s.interpretAudio(audio, ms, text ?: "")
                    text == null && err == null -> {}                                   // cancelled
                    !text.isNullOrBlank() -> s.interpret(text, ms)
                    else -> s.missed()
                }
            }
        },
        onSend = { mic.release() },
        onCancel = { if (live) { mic.cancel(); live = false } },
        onTap = { s.notice = Notice(if (!(s.cloudVoice || mic.available)) t.noVoice else if (!mic.hasPermission()) t.micDenied else t.holdHint) },
    )
}

@Composable
fun HomeScreen(s: AppState, mic: Mic) {
    if (s.chat.isNotEmpty()) { ChatFeed(s, mic); return }
    val t = s.t
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Panel {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(CircleShape).background(C.Marigold), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Mic, null, tint = C.Ink) }
                Spacer(Modifier.width(14.dp))
                Column { Text(t.holdToTalk, style = MaterialTheme.typography.titleMedium); Text(t.example, style = MaterialTheme.typography.bodyMedium) }
            }
            Spacer(Modifier.height(8.dp))
            Text(t.youCanSay, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = C.Ink2)
            t.examples.drop(1).forEach { Text(it, fontSize = 14.sp, color = C.Ink2) }
        }
        OutboxPanels(s)
        s.notice?.let { Banner(it.text, it.warn) }
        BigButton(t.tapInstead, { s.tapInstead() }, outline = !s.nudgeTap, color = C.Ink)
        Text(t.orTap, style = MaterialTheme.typography.bodyMedium)
        JobTile(s, Kind.PLACE_IN_ROOM, primary = true)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            JobTile(s, Kind.CHECKOUT_TO_STAFF, Modifier.weight(1f)); JobTile(s, Kind.RETURN_TO_STORE, Modifier.weight(1f))
        }
        JobTile(s, Kind.SUPPLIER_RECEIPT)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
fun OutboxPanels(s: AppState) {
    val t = s.t
    s.outbox.filter { it.error == null }.takeIf { it.isNotEmpty() }?.let { q ->
        Panel(border = C.Marigold, bg = C.MarigoldWash) {
            Text("${t.pending}: ${q.size}", fontWeight = FontWeight.Bold, color = C.Amber)
            q.take(3).forEach { Text(it.label, color = C.Amber) }
            Spacer(Modifier.height(6.dp)); BigButton(t.sendNow, { s.sendOutbox() }, color = C.Ink)
        }
    }
    s.outbox.filter { it.error != null }.forEach { p ->
        Panel(border = C.Brick) {
            Text(p.label, fontWeight = FontWeight.Bold); Text(p.error ?: "", color = C.Brick)
            TextButton({ s.discardPending(p.key) }) { Text("OK") }
        }
    }
}

/** The conversation: what was said on the right, what the app understood on the left, newest at the bottom. */
@Composable
fun ChatFeed(s: AppState, mic: Mic) {
    val t = s.t
    val list = rememberLazyListState()
    LaunchedEffect(s.chat.size, s.busy) { if (s.chat.isNotEmpty()) list.animateScrollToItem(s.chat.size + 1) }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp), state = list, verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(vertical = 10.dp)) {
            item { OutboxPanels(s) }
            items(s.chat, key = { it.id }) { m -> ChatRow(s, m, mic) }
            if (s.busy) item { AppBubble { Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = C.Indigo); Spacer(Modifier.width(10.dp)); Text(if (s.waitingLong) t.stillAsking else t.understanding, color = C.Ink2) } } }
            item { s.notice?.let { Banner(it.text, it.warn) } }
            item { Spacer(Modifier.height(4.dp)) }
        }
        // Quick ways on from the thread, always one tap away.
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip("🏠 ${t.home}") { s.clearChat() }
            Chip("🚪 ${t.act(Kind.PLACE_IN_ROOM).first}") { s.start(Kind.PLACE_IN_ROOM) }
            Chip("🛍️ ${t.act(Kind.CHECKOUT_TO_STAFF).first}") { s.start(Kind.CHECKOUT_TO_STAFF) }
            Chip("↩️ ${t.act(Kind.RETURN_TO_STORE).first}") { s.start(Kind.RETURN_TO_STORE) }
            Chip("👜 ${t.myBag}") { s.interpret(t.myBag, 0) }
        }
    }
}

@Composable
fun Chip(text: String, onClick: () -> Unit) {
    Text(text, Modifier.clip(RoundedCornerShape(20.dp)).background(C.Paper).border(1.dp, C.Line, RoundedCornerShape(20.dp)).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 9.dp), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = C.Ink, maxLines = 1)
}

@Composable
fun ChatRow(s: AppState, m: ChatMessage, mic: Mic) {
    val t = s.t
    when (val b = m.body) {
        is ChatBody.Said -> MeBubble(s, b.text, b.spoken, b.lang)
        is ChatBody.Text -> AppBubble(warn = b.warn) { Text(b.text, color = if (b.warn) C.Amber else C.Ink, fontSize = 16.sp) }
        is ChatBody.Retry -> AppBubble(warn = true) {
            Text(t.googleSlow, color = C.Amber, fontWeight = FontWeight.SemiBold)
            if (b.heard.isNotBlank()) Text(b.heard, color = C.Ink2, fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button({ s.notice = Notice(t.holdHint, warn = false) }, Modifier.weight(1f).height(44.dp), shape = RoundedCornerShape(22.dp), colors = ButtonDefaults.buttonColors(containerColor = C.Brick, contentColor = Color.White)) { Text(t.sayAgain) }
                OutlinedButton({ s.editSaid(b.heard) }, Modifier.weight(1f).height(44.dp), shape = RoundedCornerShape(22.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = C.Ink)) { Text(t.typeIt) }
            }
        }
        is ChatBody.Stock -> AppBubble {
            b.rows.forEach { r -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(s.product(r.productId)?.emoji() ?: "📦", fontSize = 20.sp); Spacer(Modifier.width(8.dp))
                Text(s.product(r.productId)?.native(s.lang) ?: r.name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text("${t.store} ${r.store}", Modifier.padding(end = 12.dp), fontWeight = FontWeight.ExtraBold, fontSize = 18.sp); Text("👜 ${s.bag[r.productId] ?: 0}", fontSize = 15.sp, color = C.Ink2) } }
        }
        is ChatBody.Bag -> AppBubble {
            Text(t.yourBag, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
            if (b.items.isEmpty()) Text(t.nothingInBag, fontSize = 16.sp)
            b.items.forEach { (p, q) -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text(p.emoji(), fontSize = 20.sp); Spacer(Modifier.width(8.dp)); Text(p.native(s.lang) ?: p.name, Modifier.weight(1f), fontSize = 16.sp); Text("$q", fontWeight = FontWeight.ExtraBold, fontSize = 18.sp) } }
        }
        is ChatBody.Job -> AppBubble(warn = false) { JobCard(s, m.id, b, mic) }
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
                t.langTag(lang)?.let { Text(it, Modifier.clip(RoundedCornerShape(9.dp)).background(Color.White).padding(horizontal = 7.dp, vertical = 1.dp), color = C.Indigo, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                Text("✎ ${t.tapToFix}", color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp)
            }
        }
    }
}

@Composable
fun AppBubble(warn: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(end = 16.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.size(30.dp).clip(CircleShape).background(C.Indigo), contentAlignment = Alignment.Center) { Text("✓", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp) }
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f).clip(RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)).background(if (warn) C.MarigoldWash else C.Paper).border(1.dp, if (warn) C.Marigold else C.Line, RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
    }
}

/** The job the app understood: big room, the lines, and Confirm / Edit / Cancel. Hold the small mic and say "haan" to confirm. */
@Composable
fun JobCard(s: AppState, id: Long, job: ChatBody.Job, mic: Mic) {
    val t = s.t
    val f = job.flow
    var hearing by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (f.kind == Kind.PLACE_IN_ROOM && f.roomNumber != null) { Text("🚪", fontSize = 24.sp); Spacer(Modifier.width(6.dp)); Text(f.roomNumber, fontSize = 30.sp, fontWeight = FontWeight.ExtraBold); Spacer(Modifier.width(10.dp)) }
        Text(t.act(f.kind).first, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
    }
    f.lines.forEach { l ->
        val p = s.product(l.productId)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(p?.emoji() ?: "❓", fontSize = 22.sp); Spacer(Modifier.width(8.dp))
            Text(p?.native(s.lang) ?: p?.name ?: l.spoken, Modifier.weight(1f), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Text("${l.quantity}", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
        }
    }
    when (job.state) {
        ChatState.READY -> {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (mic.available || s.cloudVoice) Box(Modifier.size(width = 52.dp, height = 48.dp).clip(RoundedCornerShape(14.dp)).background(if (hearing) C.Brick else C.Marigold)
                    .holdToTalk(onStart = {
                        if (!mic.hasPermission()) { mic.requestPermission(); return@holdToTalk }
                        hearing = true
                        mic.start(if (mic.available) s.lang else "en", false, {}, {}) { text, _ -> hearing = false
                            when (text?.let { yesNo(it) }) { true -> s.confirmChat(id); false -> s.cancelChat(id); null -> {} } }
                    }, onSend = { mic.release() }, onCancel = { mic.cancel(); hearing = false }, onTap = { s.notice = Notice(t.holdYesNo, warn = false) }),
                    contentAlignment = Alignment.Center) { Icon(Icons.Filled.Mic, t.holdYesNo, tint = if (hearing) Color.White else C.Ink) }
                Button({ s.confirmChat(id) }, Modifier.weight(1f).height(48.dp), enabled = !s.busy, shape = RoundedCornerShape(14.dp), colors = ButtonDefaults.buttonColors(containerColor = C.Mint, disabledContainerColor = C.Line)) {
                    Icon(Icons.Filled.Check, null); Spacer(Modifier.width(6.dp)); Text(t.confirm, fontWeight = FontWeight.Bold)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ s.editChat(id) }, Modifier.weight(1f).height(40.dp), shape = RoundedCornerShape(20.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = C.Ink)) { Text(t.edit) }
                OutlinedButton({ s.cancelChat(id) }, Modifier.weight(1f).height(40.dp), shape = RoundedCornerShape(20.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = C.Brick)) { Text(t.cancel) }
            }
            Text(t.holdYesNo, fontSize = 12.sp, color = C.Ink3)
        }
        ChatState.SAVING -> Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = C.Mint); Spacer(Modifier.width(8.dp)); Text("…", color = C.Ink2) }
        ChatState.SAVED -> Text("${t.savedShort}${job.ref?.let { " · $it" } ?: ""}", color = C.Mint, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        ChatState.OFFLINE -> Text(t.savedOnPhone, color = C.Amber, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        ChatState.CANCELLED -> Text(t.cancelled, color = C.Ink3, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun JobTile(s: AppState, k: Kind, modifier: Modifier = Modifier, primary: Boolean = false) {
    val (title, sub) = s.t.act(k)
    val icon = when (k) { Kind.PLACE_IN_ROOM -> "🚪"; Kind.CHECKOUT_TO_STAFF -> "🛍️"; Kind.RETURN_TO_STORE -> "↩️"; Kind.SUPPLIER_RECEIPT -> "📦" }
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (primary) C.Indigo else C.Paper)
        .border(1.dp, if (primary) C.Indigo else C.Line, RoundedCornerShape(16.dp)).clickable { s.start(k) }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(icon, fontSize = 26.sp); Spacer(Modifier.width(12.dp))
        Column { Text(title, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = if (primary) Color.White else C.Ink)
            Text(sub, fontSize = 13.sp, color = if (primary) Color(0xFFD9DDF5) else C.Ink3) }
    }
}

@Composable
fun BagScreen(s: AppState) {
    val t = s.t
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val items = s.bag.filter { it.value > 0 }
        if (items.isEmpty()) Panel { Text(t.nothingInBag) }
        items.forEach { (pid, q) -> val p = s.product(pid)
            Panel { Row(verticalAlignment = Alignment.CenterVertically) {
                Text(p?.emoji() ?: "📦", fontSize = 30.sp); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) { Text(p?.name ?: "", style = MaterialTheme.typography.titleMedium); p?.native(s.lang)?.let { Text(it, style = MaterialTheme.typography.bodyMedium) } }
                Text("$q", fontSize = 30.sp, fontWeight = FontWeight.Bold)
            } } }
        BigButton(s.t.act(Kind.RETURN_TO_STORE).first, { s.start(Kind.RETURN_TO_STORE) }, outline = true)
    }
}

@Composable
fun HistoryScreen(s: AppState) {
    val t = s.t
    val fmt = remember { DateTimeFormatter.ofPattern("dd MMM, HH:mm") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (s.history.isEmpty()) Panel { Text(t.noHistory) }
        s.history.forEach { e ->
            val k = Kind.of(e.action)
            Panel { Row {
                Column(Modifier.weight(1f)) {
                    Text((k?.let { t.act(it).first } ?: e.action) + if (e.viaVoice) " · 🎙" else "", style = MaterialTheme.typography.titleMedium)
                    Text(e.lines.orEmpty().joinToString(", ") { l -> "${l.quantity} ${l.name}" + (l.roomNumber?.let { " · ${t.room} $it" } ?: "") }, style = MaterialTheme.typography.bodyMedium)
                }
                Text(runCatching { OffsetDateTime.parse(e.createdAt).atZoneSameInstant(ZoneId.systemDefault()).format(fmt) }.getOrDefault(""), fontSize = 13.sp, color = C.Ink3, textAlign = TextAlign.End)
            } }
        }
    }
}


/** The staff member's own last voice attempts: what was heard, in which language, how fast, and what happened. For quick testing. */
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
                    val outcome = when { a.status == "FAILED" -> "✗ ${a.errorCode ?: "FAILED"}"; a.fallback != null -> "~ phone words"; a.confirmed == true -> "✓ saved"; a.status == "AMBIGUOUS" -> "? needed help"; else -> "✓ ${a.action ?: ""}" }
                    Text(outcome, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = if (a.status == "FAILED") C.Brick else C.Ink)
                }
                Text(if (a.transcript.isNullOrEmpty()) "—" else "“${a.transcript}”", fontSize = 16.sp)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(langName(a.language), Modifier.clip(RoundedCornerShape(10.dp)).background(C.IndigoWash).padding(horizontal = 7.dp, vertical = 2.dp), color = C.Indigo, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
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
    val cards = listOf(Triple(Icons.Filled.Mic, t.introTitle1, t.introBody1), Triple(Icons.Filled.TouchApp, t.introTitle2, t.introBody2),
        Triple(Icons.Filled.CheckCircle, t.introTitle3, t.introBody3), Triple(Icons.Filled.AutoAwesome, t.introTitle4, t.introBody4))
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
