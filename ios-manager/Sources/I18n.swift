import Foundation

/// English, Hindi and Gujarati text for the manager app. Numbers stay as digits in every language.
struct T {
    let lang: String
    private func s(_ en: String, _ hi: String, _ gu: String) -> String { lang == "hi" ? hi : lang == "gu" ? gu : en }

    // Sign-in
    var signIn: String { s("Sign in", "साइन इन", "સાઇન ઇન") }
    var yourCode: String { s("Employee code", "कर्मचारी कोड", "કર્મચારી કોડ") }
    var password: String { s("Password", "पासवर्ड", "પાસવર્ડ") }
    var managerApp: String { s("Manager", "मैनेजर", "મેનેજર") }
    var tagline: String { s("Your hotel store, in your pocket.", "आपका होटल स्टोर, आपकी जेब में।", "તમારો હોટેલ સ્ટોર, તમારા ખિસ્સામાં.") }
    var offlineLogin: String { s("No connection. Check the signal and try again.", "कनेक्शन नहीं है। सिग्नल देखें और फिर कोशिश करें।", "કનેક્શન નથી. સિગ્નલ જુઓ અને ફરી પ્રયત્ન કરો.") }
    var notManager: String { s("This sign-in is for managers. Staff use the Stockwise app.", "यह साइन-इन मैनेजरों के लिए है। स्टाफ़ Stockwise ऐप चलाएँ।", "આ સાઇન-ઇન મેનેજરો માટે છે. સ્ટાફ Stockwise ઍપ વાપરે.") }

    // Menu / tabs
    var today: String { s("Today", "आज", "આજ") }
    var count: String { s("Weekly count", "साप्ताहिक गिनती", "સાપ્તાહિક ગણતરી") }
    var stock: String { s("Stock", "स्टॉक", "સ્ટોક") }
    var deliveries: String { s("Deliveries", "डिलीवरी", "ડિલિવરી") }
    var activity: String { s("Activity", "गतिविधि", "પ્રવૃત્તિ") }
    var hotel: String { s("Hotel", "होटल", "હોટેલ") }
    var language: String { s("Language", "भाषा", "ભાષા") }
    var signOut: String { s("Sign out", "साइन आउट", "સાઇન આઉટ") }
    var menu: String { s("Menu", "मेन्यू", "મેનુ") }
    var howToUse: String { s("How to use", "कैसे चलाएँ", "કેવી રીતે વાપરવું") }
    var voiceAttempts: String { s("Last voice attempts", "पिछली आवाज़ कोशिशें", "છેલ્લા અવાજ પ્રયાસો") }
    var noAttempts: String { s("No voice attempts yet.", "अभी कोई आवाज़ कोशिश नहीं।", "હજુ કોઈ અવાજ પ્રયાસ નથી.") }

    // Today
    func greeting(_ name: String) -> String {
        let h = Calendar.current.component(.hour, from: Date())
        let g = h < 12 ? s("Good morning", "सुप्रभात", "સુપ્રભાત") : h < 17 ? s("Good afternoon", "नमस्ते", "નમસ્તે") : s("Good evening", "शुभ संध्या", "શુભ સાંજ")
        return "\(g), \(name)"
    }
    func needYou(_ n: Int) -> String {
        n == 0 ? s("Everything is in order.", "सब ठीक है।", "બધું બરાબર છે.")
        : n == 1 ? s("1 thing needs you", "1 बात पर ध्यान दें", "1 બાબત પર ધ્યાન આપો")
        : s("\(n) things need you", "\(n) बातों पर ध्यान दें", "\(n) બાબતો પર ધ્યાન આપો")
    }
    var needsAttention: String { s("Needs attention", "ध्यान दें", "ધ્યાન આપો") }
    var storeNow: String { s("Store right now", "स्टोर अभी", "સ્ટોર હમણાં") }
    var seeStock: String { s("See stock", "स्टॉक देखें", "સ્ટોક જુઓ") }
    var open: String { s("Open", "खोलें", "ખોલો") }
    var startCount: String { s("Start count", "गिनती शुरू", "ગણતરી શરૂ") }
    var review: String { s("Review", "देखें", "જુઓ") }
    func reorderAt(_ n: Int) -> String { s("reorder at \(n)", "\(n) पर मँगाएँ", "\(n) પર મંગાવો") }
    var staffCarry: String { s("with staff", "स्टाफ़ के पास", "સ્ટાફ પાસે") }
    var inTransit: String { s("on the way", "रास्ते में", "રસ્તામાં") }
    var outOfStock: String { s("out of stock", "ख़त्म", "ખલાસ") }
    var low: String { s("low", "कम", "ઓછું") }

    // Voice
    var askHere: String { s("Ask: “how much soap is left?”", "पूछें: “साबुन कितना बचा?”", "પૂછો: “સાબુ કેટલો બચ્યો?”") }
    var countHere: String { s("Say: “soap forty-eight”", "बोलें: “साबुन अड़तालीस”", "બોલો: “સાબુ અડતાલીસ”") }
    var holdToTalk: String { s("Hold to talk", "बोलने के लिए दबाए रखें", "બોલવા દબાવી રાખો") }
    var holdHint: String { s("Hold the mic while you speak, then let go.", "बोलते समय माइक दबाए रखें, फिर छोड़ें।", "બોલતી વખતે માઇક દબાવી રાખો, પછી છોડો.") }
    var slideToCancel: String { s("‹ slide to cancel", "‹ रद्द करने के लिए खिसकाएँ", "‹ રદ કરવા ખસેડો") }
    var releaseToCancel: String { s("Release to cancel", "रद्द करने के लिए छोड़ें", "રદ કરવા છોડો") }
    var listening: String { s("Listening…", "सुन रहे हैं…", "સાંભળી રહ્યા છીએ…") }
    var understanding: String { s("Understanding…", "समझ रहे हैं…", "સમજી રહ્યા છીએ…") }
    var stillAsking: String { s("Still asking Google…", "अभी भी Google से पूछ रहे हैं…", "હજુ Google ને પૂછી રહ્યા છીએ…") }
    var googleSlow: String { s("Google didn’t answer in time.", "Google ने समय पर जवाब नहीं दिया।", "Google એ સમયસર જવાબ ન આપ્યો.") }
    var sayAgain: String { s("Say it again", "फिर से बोलें", "ફરી બોલો") }
    var typeIt: String { s("Type it", "लिख दें", "લખો") }
    var tapToFix: String { s("Tap to correct", "सुधारने के लिए दबाएँ", "સુધારવા દબાવો") }
    var fromPhoneWords: String { s("Google was slow, so this is from what the phone heard. Check it.", "Google धीमा था, इसलिए यह फ़ोन ने जो सुना उससे है। जाँच लें।", "Google ધીમું હતું, એટલે આ ફોને જે સાંભળ્યું તેના પરથી છે. ચકાસો.") }
    var noGuVoice: String { s("This iPhone has no Gujarati voice, so replies are read in Hindi.", "इस iPhone में गुजराती आवाज़ नहीं है, इसलिए जवाब हिंदी में पढ़े जाएँगे।", "આ iPhone માં ગુજરાતી અવાજ નથી, એટલે જવાબ હિન્દીમાં વંચાશે.") }
    var offlineVoice: String { s("No signal. The phone will listen by itself; keep sentences short.", "सिग्नल नहीं है। फ़ोन खुद सुनेगा; वाक्य छोटे रखें।", "સિગ્નલ નથી. ફોન જાતે સાંભળશે; વાક્યો ટૂંકાં રાખો.") }
    var offlineVoiceGu: String { s("No signal, and this iPhone can’t hear Gujarati on its own. Use the buttons until you’re back online.", "सिग्नल नहीं है, और यह iPhone खुद गुजराती नहीं सुन सकता। ऑनलाइन होने तक बटन इस्तेमाल करें।", "સિગ્નલ નથી, અને આ iPhone જાતે ગુજરાતી સાંભળી શકતો નથી. ઓનલાઇન થાઓ ત્યાં સુધી બટન વાપરો.") }
    var notUnderstood: String { s("Didn’t catch that. Try: “how much shampoo?” or “who took combs today?”", "समझ नहीं आया। कहें: “शैम्पू कितना?” या “आज कंघी किसने ली?”", "સમજાયું નહીં. કહો: “શેમ્પૂ કેટલું?” કે “આજે કાંસકો કોણે લીધો?”") }
    var notInApp: String { s("Recording stock movements is done by staff in their app, or on the website.", "स्टॉक की आवाजाही स्टाफ़ अपने ऐप में या वेबसाइट पर दर्ज करता है।", "સ્ટોકની હેરફેર સ્ટાફ પોતાની ઍપમાં કે વેબસાઇટ પર નોંધે છે.") }
    var typeHere: String { s("Type here", "यहाँ लिखें", "અહીં લખો") }
    func langTag(_ code: String?) -> String? {
        switch code { case "gu": return "ગુજરાતી"; case "hi": return "हिंदी"; case "en": return "English"; case "mixed": return s("Mixed", "मिश्रित", "મિશ્ર"); default: return nil }
    }
    var nothingLow: String { s("Nothing is low.", "कुछ भी कम नहीं है।", "કંઈ ઓછું નથી.") }
    func stockSentence(_ r: QueryRow) -> String {
        let where_ = r.hotelName.map { " (\($0))" } ?? ""
        return s("\(r.name): \(r.store) in the store\(where_)", "\(r.name): स्टोर में \(r.store)\(where_)", "\(r.name): સ્ટોરમાં \(r.store)\(where_)")
    }

    // Count
    var countDue: String { s("Weekly count due", "साप्ताहिक गिनती बाकी", "સાપ્તાહિક ગણતરી બાકી") }
    var countOverdue: String { s("Weekly count overdue", "साप्ताहिक गिनती देर से", "સાપ્તાહિક ગણતરી મોડી") }
    var countDone: String { s("This week’s count is done", "इस हफ़्ते की गिनती हो गई", "આ અઠવાડિયાની ગણતરી થઈ ગઈ") }
    var continueCount: String { s("Continue count", "गिनती जारी रखें", "ગણતરી ચાલુ રાખો") }
    var book: String { s("Book", "बही", "ચોપડો") }
    var counted: String { s("Counted", "गिना", "ગણ્યું") }
    func progress(_ done: Int, _ total: Int) -> String { s("\(done) of \(total) counted", "\(total) में से \(done) गिने", "\(total) માંથી \(done) ગણ્યા") }
    func left(_ n: Int) -> String { s("\(n) left · say them, or tap a box to type", "\(n) बाकी · बोलें, या लिखने के लिए डिब्बा दबाएँ", "\(n) બાકી · બોલો, કે લખવા બૉક્સ દબાવો") }
    var reasonAsk: String { s("Differs from the book — why?", "बही से अलग — क्यों?", "ચોપડાથી અલગ — કેમ?") }
    var submitCount: String { s("Submit count", "गिनती जमा करें", "ગણતરી જમા કરો") }
    var cancelCount: String { s("Cancel count", "गिनती रद्द करें", "ગણતરી રદ કરો") }
    var countSubmitted: String { s("Count submitted. Stock now matches what you counted.", "गिनती जमा हुई। स्टॉक अब आपकी गिनती से मेल खाता है।", "ગણતરી જમા થઈ. સ્ટોક હવે તમારી ગણતરી સાથે મેળ ખાય છે.") }
    var countNeedsAll: String { s("Count every item before submitting.", "जमा करने से पहले हर चीज़ गिनें।", "જમા કરતાં પહેલાં દરેક વસ્તુ ગણો.") }
    var countNeedsReasons: String { s("Give a reason for each difference.", "हर अंतर का कारण दें।", "દરેક તફાવતનું કારણ આપો.") }
    var stockMoved: String { s("Stock moved while you counted — these items were reset.", "गिनते समय स्टॉक बदला — ये चीज़ें रीसेट हुईं।", "ગણતી વખતે સ્ટોક બદલાયો — આ વસ્તુઓ રીસેટ થઈ.") }
    func heardCount(_ n: Int) -> String { s("Heard \(n) item\(n == 1 ? "" : "s")", "\(n) चीज़ें सुनीं", "\(n) વસ્તુ સાંભળી") }
    func reason(_ code: String) -> String {
        switch code {
        case "COUNTING_ERROR": return s("Counting mistake earlier", "पहले गिनती की गलती", "પહેલાં ગણતરીની ભૂલ")
        case "DAMAGED": return s("Damaged", "खराब", "બગડેલું")
        case "UNRECORDED_ISSUE": return s("Given out, not recorded", "दिया, दर्ज नहीं", "આપ્યું, નોંધ્યું નહીં")
        case "RECEIPT_OVERSIGHT": return s("Delivery not recorded", "डिलीवरी दर्ज नहीं", "ડિલિવરી નોંધી નહીં")
        case "EXPIRED": return s("Expired", "समाप्त", "સમાપ્ત")
        default: return s("Other", "अन्य", "અન્ય")
        }
    }
    var lastCounts: String { s("Past counts", "पिछली गिनतियाँ", "પાછલી ગણતરીઓ") }

    // Deliveries
    var incoming: String { s("Coming in", "आ रही", "આવી રહી") }
    var outgoing: String { s("Going out", "जा रही", "જઈ રહી") }
    var noOpenDeliveries: String { s("No open deliveries.", "कोई खुली डिलीवरी नहीं।", "કોઈ ખુલ્લી ડિલિવરી નથી.") }
    var arrivedShort: String { s("Arrived short", "कम आई", "ઓછી આવી") }
    func notReceived(_ h: Int) -> String { s("Not received · \(h) h", "नहीं मिली · \(h) घं", "મળી નથી · \(h) ક") }
    var partlyReceived: String { s("Partly received", "आंशिक मिली", "અંશતઃ મળી") }
    var receiveAll: String { s("All arrived", "सब आ गया", "બધું આવ્યું") }
    var receiveSome: String { s("Record what arrived", "जो आया दर्ज करें", "જે આવ્યું તે નોંધો") }
    var arrived: String { s("Arrived", "आया", "આવ્યું") }
    var sent: String { s("sent", "भेजा", "મોકલ્યું") }
    var received: String { s("received", "मिला", "મળ્યું") }
    var missing: String { s("missing", "कम", "ખૂટે") }
    var thisIsAll: String { s("This is everything that arrived", "बस इतना ही आया", "બસ આટલું જ આવ્યું") }
    var settle: String { s("Settle the shortfall", "कमी निपटाएँ", "ઘટ પતાવો") }
    var settleLost: String { s("Lost", "खो गया", "ખોવાયું") }
    var settleDamaged: String { s("Damaged", "खराब", "બગડેલું") }
    var settleCountingError: String { s("Counting error", "गिनती की गलती", "ગણતરીની ભૂલ") }
    var settleOther: String { s("Other", "अन्य", "અન્ય") }
    var sendStock: String { s("Send stock", "स्टॉक भेजें", "સ્ટોક મોકલો") }
    func toHotel(_ n: String) -> String { s("To \(n)", "\(n) को", "\(n) ને") }
    var send: String { s("Send", "भेजें", "મોકલો") }
    var lastWeek: String { s("Last 7 days", "पिछले 7 दिन", "છેલ્લા 7 દિવસ") }
    var receivedInFull: String { s("Received in full", "पूरा मिला", "પૂરું મળ્યું") }
    var saved: String { s("Saved", "सहेजा", "સાચવ્યું") }
    var note: String { s("Note (optional)", "टिप्पणी (वैकल्पिक)", "નોંધ (વૈકલ્પિક)") }

    // Activity
    func changesToday(_ n: Int) -> String { s("Today · \(n) changes", "आज · \(n) बदलाव", "આજ · \(n) ફેરફાર") }
    var reverse: String { s("Reverse", "पलटें", "ઉલટાવો") }
    var reversed: String { s("Reversed", "पलटा", "ઉલટાવ્યું") }
    var whyReverse: String { s("Why is this wrong?", "यह गलत क्यों है?", "આ ખોટું કેમ છે?") }
    var reverseNow: String { s("Reverse this entry", "यह प्रविष्टि पलटें", "આ એન્ટ્રી ઉલટાવો") }
    var reverseNote: String { s("The original stays in the record; a reversing entry is added.", "मूल रिकॉर्ड में रहता है; एक पलटने वाली प्रविष्टि जुड़ती है।", "મૂળ રેકોર્ડમાં રહે છે; એક ઉલટાવતી એન્ટ્રી ઉમેરાય છે.") }
    func asksToCorrect(_ who: String) -> String { s("\(who) asks to correct", "\(who) सुधार चाहते हैं", "\(who) સુધારો માગે છે") }
    var leaveAsIs: String { s("Leave as is", "ऐसा ही रहने दें", "એમ જ રહેવા દો") }
    var viaVoice: String { s("by voice", "आवाज़ से", "અવાજથી") }
    var byHand: String { s("by hand", "हाथ से", "હાથે") }
    func actionName(_ a: String) -> String {
        switch a {
        case "PLACE_IN_ROOM": return s("Put in room", "कमरे में रखा", "રૂમમાં મૂક્યું")
        case "CHECKOUT_TO_STAFF": return s("Store → staff", "स्टोर → स्टाफ़", "સ્ટોર → સ્ટાફ")
        case "RETURN_TO_STORE": return s("Staff → store", "स्टाफ़ → स्टोर", "સ્ટાફ → સ્ટોર")
        case "SUPPLIER_RECEIPT": return s("Delivery received", "डिलीवरी मिली", "ડિલિવરી મળી")
        case "TRANSFER_DISPATCH": return s("Sent to hotel", "होटल को भेजा", "હોટેલને મોકલ્યું")
        case "TRANSFER_RECEIPT": return s("Received from hotel", "होटल से मिला", "હોટેલથી મળ્યું")
        case "REVERSAL": return s("Reversed", "पलटा", "ઉલટાવ્યું")
        case "COUNT_ADJUSTMENT": return s("Count adjustment", "गिनती सुधार", "ગણતરી સુધારો")
        default: return a
        }
    }

    // Generic
    var cancel: String { s("Cancel", "रद्द", "રદ") }
    var done: String { s("Done", "हो गया", "થઈ ગયું") }
    var retry: String { s("Try again", "फिर कोशिश", "ફરી પ્રયત્ન") }
    var nothingYet: String { s("Nothing yet.", "अभी कुछ नहीं।", "હજુ કંઈ નહીં.") }
    var close: String { s("Close", "बंद", "બંધ") }
    var yes: String { s("Yes", "हाँ", "હા") }
    var no: String { s("No", "नहीं", "ના") }

    // Walkthrough
    var introTitle1: String { s("Ask the store anything", "स्टोर से कुछ भी पूछें", "સ્ટોરને કંઈ પણ પૂછો") }
    var introBody1: String { s("Hold the mic and ask in Gujarati, Hindi or English: “how much soap is left?”, “who took combs today?”", "माइक दबाकर गुजराती, हिंदी या अंग्रेज़ी में पूछें: “साबुन कितना बचा?”, “आज कंघी किसने ली?”", "માઇક દબાવીને ગુજરાતી, હિન્દી કે અંગ્રેજીમાં પૂછો: “સાબુ કેટલો બચ્યો?”, “આજે કાંસકો કોણે લીધો?”") }
    var introTitle2: String { s("Count hands-free", "बिना हाथ लगाए गिनें", "હાથ લગાડ્યા વિના ગણો") }
    var introBody2: String { s("On the count screen, walk the store and say “soap forty-eight, shampoo thirty”. Boxes fill as you speak.", "गिनती स्क्रीन पर स्टोर में चलते हुए बोलें “साबुन अड़तालीस, शैम्पू तीस”। डिब्बे खुद भरते हैं।", "ગણતરી સ્ક્રીન પર સ્ટોરમાં ફરતાં બોલો “સાબુ અડતાલીસ, શેમ્પૂ ત્રીસ”. બૉક્સ જાતે ભરાય છે.") }
    var introTitle3: String { s("Nothing changes without a tap", "बिना दबाए कुछ नहीं बदलता", "દબાવ્યા વિના કંઈ બદલાતું નથી") }
    var introBody3: String { s("Voice only fills things in. Submitting a count, receiving a delivery or reversing an entry is always a button you press.", "आवाज़ सिर्फ़ भरती है। गिनती जमा करना, डिलीवरी लेना या प्रविष्टि पलटना हमेशा आपके दबाए बटन से होता है।", "અવાજ ફક્ત ભરે છે. ગણતરી જમા કરવી, ડિલિવરી લેવી કે એન્ટ્રી ઉલટાવવી હંમેશાં તમે દબાવેલા બટનથી થાય છે.") }
    var introTitle4: String { s("Try it now", "अभी आज़माएँ", "હમણાં અજમાવો") }
    var introBody4: String { s("Hold the mic and ask “how much soap?”. It only answers — it changes nothing.", "माइक दबाकर पूछें “साबुन कितना?”। यह सिर्फ़ जवाब देता है — कुछ बदलता नहीं।", "માઇક દબાવીને પૂછો “સાબુ કેટલો?”. આ ફક્ત જવાબ આપે છે — કંઈ બદલાતું નથી.") }
    var introNext: String { s("Next", "आगे", "આગળ") }
    var introTry: String { s("Try it", "आज़माएँ", "અજમાવો") }
    var introSkip: String { s("Skip", "छोड़ें", "છોડો") }
    var introDone: String { s("That’s it — you’re ready. 🎉", "बस — आप तैयार हैं। 🎉", "બસ — તમે તૈયાર છો. 🎉") }
    var introPractice: String { s("Hold the mic and ask “how much soap?”", "माइक दबाकर पूछें “साबुन कितना?”", "માઇક દબાવીને પૂછો “સાબુ કેટલો?”") }
}
