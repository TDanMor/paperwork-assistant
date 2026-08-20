const streetRegex = /[A-ZÄÖÜ][a-zäöüß\s.-]+ \d+[a-zA-Z]?/;
const pcLine = "OH Business Solutions, Olivia Hugot, Kappelbergsteig 33E, 91126 Schwabach";
const isSingleLineAddress = pcLine.includes(',') && streetRegex.test(pcLine) && pcLine.length > 20;
console.log("isSingleLineAddress:", isSingleLineAddress);

if (isSingleLineAddress) {
    if (pcLine.includes(',') && /\b\d{5}\b/.test(pcLine)) {
        const recoveredSender = pcLine.split(',')[0].trim();
        console.log("Recovered:", recoveredSender);
    }
}
