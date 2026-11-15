import Foundation

/// English, Hindi and Gujarati text for the staff app. Numbers stay as digits in every language.
struct T {
    let lang: String
    private func s(_ en: String, _ hi: String, _ gu: String) -> String { lang == "hi" ? hi : lang == "gu" ? gu : en }
    var signIn: String { s("Sign in", "साइन इन", "સાઇન ઇન") }
    var yourCode: String { s("Your code", "आपका कोड", "તમારો કોડ") }
    var passcode: String { s("Passcode", "पासकोड", "પાસકોડ") }
    var tagline: String { s("Hotel amenities, counted right.", "होटल सामान, सही गिनती।", "હોટેલ સામાન, સાચી ગણતરી.") }
    var home: String { s("Home", "होम", "હોમ") }
    var myBag: String { s("My bag", "मेरा बैग", "મારી બેગ") }
    var history: String { s("History", "इतिहास", "ઇતિહાસ") }
    var language: String { s("Language", "भाषा", "ભાષા") }
    var signOut: String { s("Sign out", "साइन आउट", "સાઇન આઉટ") }
    var holdToTalk: String { s("Hold the mic and say what you did", "माइक दबाकर रखें और बोलें", "માઇક દબાવી રાખો અને બોલો") }
    var example: String { s("“Put two soaps in room 203”", "“रूम 203 में दो साबुन रखे”", "“રૂમ 203 માં બે સાબુ મૂક્યા”") }
    var typeHere: String { s("Type: room 203, 2 soap", "लिखें: रूम 203, 2 साबुन", "લખો: રૂમ 203, 2 સાબુ") }
    var slideToCancel: String { s("◀ Slide to cancel", "◀ रद्द करने के लिए खिसकाएँ", "◀ રદ કરવા ખસેડો") }
    var releaseToCancel: String { s("Release to cancel", "रद्द करने के लिए छोड़ें", "રદ કરવા છોડો") }
    var holdHint: String { s("Keep holding the mic while you speak, then let go.", "बोलते समय माइक दबाकर रखें, फिर छोड़ें।", "બોલો ત્યાં સુધી માઇક દબાવી રાખો, પછી છોડો.") }
    var understanding: String { s("Understanding…", "समझ रहे हैं…", "સમજી રહ્યા છીએ…") }
    var notUnderstood: String { s("Didn’t catch that. Try again, or tap below.", "समझ नहीं आया। फिर बोलें, या नीचे दबाएँ।", "સમજાયું નહીં. ફરી બોલો, અથવા નીચે દબાવો.") }
    var twiceFailed: String { s("Didn’t catch that twice — let’s tap instead.", "दो बार समझ नहीं आया — दबाकर करते हैं।", "બે વાર સમજાયું નહીં — દબાવીને કરીએ.") }
    var micDenied: String { s("Allow the microphone for Stockwise, or type instead.", "Stockwise को माइक की अनुमति दें, या लिखें।", "Stockwise ને માઇકની મંજૂરી આપો, અથવા લખો.") }
    var noVoice: String { s("Voice isn’t available on this phone. Type or tap instead.", "इस फ़ोन पर आवाज़ नहीं चलती। लिखें या दबाएँ।", "આ ફોનમાં અવાજ ચાલતો નથી. લખો અથવા દબાવો.") }
    var tapInstead: String { s("✋ Tap instead", "✋ दबाकर करें", "✋ દબાવીને કરો") }
    var orTap: String { s("Or tap what you did", "या जो किया उसे चुनें", "અથવા તમે શું કર્યું તે પસંદ કરો") }
    var whichRoom: String { s("Which room?", "कौन सा कमरा?", "કયો રૂમ?") }
    var room: String { s("Room", "कमरा", "રૂમ") }
    var recent: String { s("Recent", "हाल के", "તાજેતરના") }
    var next: String { s("Next", "आगे", "આગળ") }
    var whatDidYouPut: String { s("What did you put?", "क्या रखा?", "શું મૂક્યું?") }
    var whichItems: String { s("Which items?", "कौन सा सामान?", "કઈ વસ્તુ?") }
    var tapToAdd: String { s("Tap a picture to add one. Tap again for more.", "एक जोड़ने के लिए चित्र दबाएँ, ज़्यादा के लिए फिर दबाएँ।", "એક ઉમેરવા ચિત્ર દબાવો, વધુ માટે ફરી દબાવો.") }
    var check: String { s("Check and confirm", "जाँचें और पुष्टि करें", "તપાસો અને પુષ્ટિ કરો") }
    var confirm: String { s("Confirm", "पुष्टि करें", "પુષ્ટિ કરો") }
    var fromBag: String { s("From my bag", "मेरे बैग से", "મારી બેગમાંથી") }
    var fromStore: String { s("From the store", "स्टोर से", "સ્ટોરમાંથી") }
    var chooseFrom: String { s("Where did these come from?", "ये कहाँ से आए?", "આ ક્યાંથી આવ્યા?") }
    var chooseItem: String { s("Which item?", "कौन सा सामान?", "કઈ વસ્તુ?") }
    var heard: String { s("Heard", "सुना", "સાંભળ્યું") }
    var holdYesNo: String { s("Hold the mic and say “yes” / “no”", "माइक दबाकर बोलें “हाँ” / “नहीं”", "માઇક દબાવી બોલો “હા” / “ના”") }
    var saved: String { s("Saved", "सेव हो गया", "સેવ થયું") }
    var savedOnPhone: String { s("Saved on this phone. It will be sent when there is signal.", "फ़ोन पर सेव हुआ। सिग्नल आने पर भेजा जाएगा।", "ફોન પર સેવ થયું. સિગ્નલ આવે ત્યારે મોકલાશે.") }
    var pending: String { s("Waiting to send", "भेजना बाकी", "મોકલવાનું બાકી") }
    var sendNow: String { s("Send now", "अभी भेजें", "હમણાં મોકલો") }
    var backSoon: String { s("Back to start in a moment", "थोड़ी देर में शुरुआत पर", "થોડી વારમાં શરૂઆતમાં") }
    var doAnother: String { s("Do another", "एक और", "બીજું નોંધો") }
    var nothingInBag: String { s("Your bag is empty.", "आपका बैग खाली है।", "તમારી બેગ ખાલી છે.") }
    var noHistory: String { s("Nothing recorded yet.", "अभी कुछ दर्ज नहीं।", "હજી કંઈ નોંધાયું નથી.") }
    var retry: String { s("Try again", "फिर कोशिश करें", "ફરી પ્રયાસ કરો") }
    var store: String { s("Store", "स्टोर", "સ્ટોર") }
    var inBag: String { s("in your bag", "आपके बैग में", "તમારી બેગમાં") }
    var youCanSay: String { s("You can say", "आप बोल सकते हैं", "તમે બોલી શકો") }
    var examples: [String] { lang == "hi" ? ["“रूम 203 में दो साबुन रखे”", "“स्टोर से दस साबुन लिए”", "“तीन शैम्पू वापस”", "“बीस साबुन आए”", "“कितने साबुन बचे?”", "“मेरा बैग” · “इतिहास” · “साइन आउट”"] : lang == "gu" ? ["“રૂમ 203 માં બે સાબુ મૂક્યા”", "“સ્ટોરમાંથી દસ સાબુ લીધા”", "“ત્રણ શેમ્પૂ પરત”", "“વીસ સાબુ આવ્યા”", "“કેટલા સાબુ બચ્યા?”", "“મારી બેગ” · “ઇતિહાસ” · “સાઇન આઉટ”"] : ["“Put two soaps in room 203”", "“Take ten soap from the store”", "“Return three shampoo”", "“Twenty soap arrived”", "“How many soap are left?”", "“My bag” · “History” · “Sign out”"] }
    func act(_ k: Kind) -> (String, String) {
        switch k {
        case .placeInRoom: return (s("Put in room", "कमरे में रखा", "રૂમમાં મૂક્યું"), s("From your bag or the store", "बैग या स्टोर से", "બેગ કે સ્ટોરમાંથી"))
        case .checkoutToStaff: return (s("Take from store", "स्टोर से लिया", "સ્ટોરમાંથી લીધું"), s("Into your bag", "अपने बैग में", "તમારી બેગમાં"))
        case .returnToStore: return (s("Return to store", "स्टोर में वापस", "સ્ટોરમાં પાછું"), s("From your bag", "अपने बैग से", "તમારી બેગમાંથી"))
        case .supplierReceipt: return (s("Stock arrived", "सामान आया", "સામાન આવ્યો"), s("From the supplier", "सप्लायर से", "સપ્લાયર પાસેથી"))
        }
    }
    func summary(_ k: Kind, _ n: Int, _ room: String?) -> String {
        let r = room ?? "?"
        switch k {
        case .placeInRoom: return s("\(n) items in room \(r)", "कमरा \(r) में \(n) सामान", "રૂમ \(r) માં \(n) વસ્તુ")
        case .checkoutToStaff: return s("\(n) items taken from the store", "स्टोर से \(n) सामान लिया", "સ્ટોરમાંથી \(n) વસ્તુ લીધી")
        case .returnToStore: return s("\(n) items returned to the store", "\(n) सामान स्टोर में वापस", "\(n) વસ્તુ સ્ટોરમાં પાછી")
        case .supplierReceipt: return s("\(n) items arrived", "\(n) सामान आया", "\(n) વસ્તુ આવી")
        }
    }
    var offlineLogin: String { s("No connection. Check the phone's internet and try again.", "कनेक्शन नहीं है। फ़ोन का इंटरनेट देखें और फिर कोशिश करें।", "કનેક્શન નથી. ફોનનું ઇન્ટરનેટ તપાસો અને ફરી પ્રયાસ કરો.") }
    var noVoiceLang: String { s("Voice isn’t available in this language on this iPhone. Type or tap instead.", "इस iPhone पर इस भाषा में आवाज़ नहीं चलती। लिखें या दबाएँ।", "આ iPhone પર આ ભાષામાં અવાજ ચાલતો નથી. લખો અથવા દબાવો.") }
}
