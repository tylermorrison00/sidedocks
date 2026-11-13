# Side Dock — Fix Loop Memory (user order, Nov 2, 2026)

Ye file is liye hai taake ek fix dusri problem na banaye, aur agla fix pehli baar me theek ho.
Har naye fix se pehle ye file parhna LAZMI hai, aur har fix ke baad is me naya lesson add karna hai.

## The Loop (asal problem)
Hide/close ka rasta ek hi shared path hai, alag alag cheezein nahi:
dock CSS + window bounds + arrow timing + body classes + theme variables — sab ek dusre se jude hue hain.
Ek ko chhero to dusra toot-ta hai. Is liye har fix ke baad poora hide path dobara test karna hai, sirf wo ek cheez nahi:
expanded hide, collapsed hide, arrow show, theme Dark/Light, tooltip, settings gear, Add Tool absent.

## Lessons — har ek ek baar dard se seekha gaya

1. VM pass != Windows pass.
   VM Xvfb 100% scaling par hai, user ki machine 125% scaling par hai.
   VM Windows DWM resize animation dikha hi nahi sakta.
   VM pass ka matlab sirf: bounds sequence aur CSS values theek hain.
   User ko "ho gaya" kehne se pehle ye caveat batana hai, aur jahan mumkin ho DWM par depend na karne wala fix banana hai (resize hi khatam kar do, sirf position slide karo).

2. Window resize hi shrink ka sab se bara sabab hai.
   setSize phir setPosition = pehle upar chota, phir center jump.
   Single setBounds = behtar, par Windows DWM phir bhi resize animate kar sakta hai.
   Hide ke waqt window hide karke resize karna = behtar, par pakka hal nahi.
   Pakka hal (v2.9.8): window ka size KABHI change mat karo, sirf x slide karo 1696 -> 1892, size hamesha 220x1064.
   Phir shrink dikh hi nahi sakta, kyunki shrink hota hi nahi.

3. Dock width lock karna lazmi hai.
   body.hidden display:grid center ne dock ko 220 se 181.48px kar diya tha (content width).
   Fix: body.hidden .dock width 220px flex 0 0 220px.
   Collapsed ke liye alag: body.hidden.collapsed .dock width 56px flex 0 0 56px, warna collapsed bhi 220 ho jayega.

4. Body display change dock ki position badal deta hai.
   Body flex-end se block/grid hone par collapsed 56px dock right edge (x=164) se left edge (x=0) par jump kar gaya — wahi expanded position.
   Fix: hide ke doran body display:flex justify-content:flex-end hi rakho.
   Collapsed dock hide me bhi right edge par hi rehna chahiye, kabhi left edge par nahi.

5. Slide ko kaatna mat.
   CSS transition 300ms hai, par start late hota hai. 200ms ya 320ms timeout slide ko 217px par kaat deta tha, 264px tak nahi pahunchta tha.
   Fix: slide poora hone tak wait karo (500ms), ya transitionend par karo. Timeout transition se chota kabhi mat rakho.

6. Arrow ka timing ek hi jagah se control ho.
   Main ka hideTimeout aur renderer ka arrow-only timer dono 500ms, alag processes, race hoti hai — kabhi arrow pehle, kabhi baad.
   Fix: arrow-only SIRF main se aaye, jab window slide poora ho jaye. Renderer ka apna timer hata do.
   Arrow slide ke doran chhupa rahe (body.hidden #arrowTab display:none), sirf slide ke baad edge par dikhe (body.hidden.arrow-only #arrowTab display:grid, left:0).

7. Teen layers check karo, ek nahi: main send + preload expose + renderer listen.
   v2.9.9 me main ne auto-hide-arrow-only bheja, preload ne expose kiya, par renderer ne listener register hi nahi kiya — arrow kabhi aaya hi nahi.
   Har IPC feature par ye teenon check karo, warna ek layer miss ho jayegi.

8. CSS order / specificity.
   body.arrow-only #arrowTab (line 119) ke baad body.hidden #arrowTab (line 120) aaya to hidden jeet gaya, arrow none hi raha.
   Fix: combined selector body.hidden.arrow-only #arrowTab ko SAB se baad me rakho, taake wo jeete.
   Har CSS change ke baad order check karo, sirf value nahi.

9. Width transition dock ko chota karta hai.
   .dock transition me width .30s tha, is liye layout change par dock width animate hoke chota dikhta tha.
   Fix: dock transition me sirf transform aur opacity rakho, width kabhi mat rakho.

10. Hardcoded color theme torta hai.
    Tooltip background hardcoded #2e211a tha, is liye Light theme me bhi dark popup dikhta tha.
    Fix: hamesha var(--panel) / var(--text) / var(--line) use karo, hardcoded color kabhi mat rakho.
    Opacity ke liye solid hex ki jagah rgba use karo (0.85), taake Light aur Dark dono me opacity kam ho.

11. Version rule.
    Version number kabhi reuse mat karo — same number par updater "already latest" kehta hai, user update hi nahi kar pata.
    Har change = naya version, chahe change chota hi kyun na ho.

12. Glassmorphism loop — khatam.
    Blur + no corners + no separate layer: CSS backdrop-filter sirf page ke andar blur karta hai, desktop nahi.
    Window acrylic poori window ko frost karta hai, corners nikal aate hain.
    Ye loop user ne khatam kar diya: glassmorphism aur blur poori tarah hata do, sirf Light aur Dark rakho.
    Dobara glass wapas mat lana jab tak user khud na kahe.

## Lesson 14 — To Do Done box drop-up (Nov 13, 2026, v2.19.6)
- Check karne par task active list se gayab hota hai, Done box me save hota hai — data delete nahi hota, sirf filter hota hai (active vs done, toggleTodo se wapas aata hai).
- Done box panel ke neeche rehta hai, header "✓ Completed • n tasks done", arrow ▲ band / ▼ khula. Drop-up list header ke upar khulti hai (position:absolute; bottom:100%), max-height 280px, scrollable, active list ka aadha hissa overlap karti hai.
- Done box sirf To Do tool me dikhta hai — Notes/Habits/Brightness/other tools kholne par hide karna lazmi hai, warna dusre tools me bhi nazar aayega.
- Version rule: version kabhi same nahi rehta — v2.19.5 se v2.19.6 bump karna lazmi tha, warna updater "already up to date" kehta hai. User ne v1.0.0 hi rakhne ko kaha tha, ye mumkin nahi hai.

## Har fix se pehle checklist (ye na ho to fix mat bhejo)
- [ ] Expanded hide: dock width 220, transform 0->264, opacity 1->0, window size 220x1064 unchanged, x only slides
- [ ] Collapsed hide: dock x=164 w=56, kabhi x=0 par nahi, window size unchanged
- [ ] Arrow: slide ke doran none, slide ke baad edge par grid, real click se show back
- [ ] Theme: Dark/Light only, no Glass, tooltip theme se aaye
- [ ] Settings gear visible, Add Tool absent
- [ ] Version bumped, VM test pass, Windows caveat likha hua
- [ ] Is file me naya lesson add kiya hua

## Version history — kya toota, kya seekha
- v2.9.2 setBounds: top shrink khatam, par Windows DWM shrink baqi raha
- v2.9.5 hide-during-resize: window bounds clean, par dock width shrink baqi raha
- v2.9.6 width transition hatao + 320ms: VM me FAIL, dock 181px + slide truncate mila
- v2.9.7 dock width lock + 500ms: VM PASS, par user ki machine par phir bhi shrink (DWM)
- v2.9.8 window-slide, no resize: VM PASS, shrink khatam, par arrow slide ke sath aa gaya
- v2.9.9 arrow slide ke baad: VM FAIL, arrow kabhi aaya hi nahi (listener + CSS order)
- v2.9.10 listener + CSS order fix: VM PASS, arrow slide ke baad edge par
- v2.9.11 collapsed hide right edge fix: VM PASS, collapsed kabhi left edge par nahi

## Lesson 13 — Invisible bar blocks underlying windows (Nov 3, 2026)
- Hidden/arrow-only ke baad window ka ignoreMouseEvents FALSE tha, is liye 220px wide transparent window, jo screen par sirf 28px arrow strip dikhata hai, poori height par neeche wali window ke clicks rok raha tha — X button bhi, koi bhi button/bar bhi.
- Fix: slideToHidden complete hone par setIgnoreMouseEvents(true, {forward:true}) LAZMI hai, false kabhi nahi. Arrow hover forwarded mouse move se hi show hota hai, is liye ignore=true par bhi arrow kaam karta hai.
- Visible sidebar par setIgnoreMouseEvents(false) theek hai, hidden par kabhi nahi.
