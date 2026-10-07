# Petrol Pump CRM

Petrol pump ke udhar (credit) customers ka hisaab rakhne ki web app: customer jodna,
udhar aur jama ki entry, aur byaaj (interest) ka apne-aap calculation.

## Kya-kya hai

- **Customers**: naam, mobile, gaadi number, pata, credit limit, aur har customer ka alag byaaj rate (optional)
- **Udhar entry**: tareekh, Petrol/Diesel/CNG, litre × rate = amount (apne-aap), gaadi no., bill no.
- **Jama entry**: udhar ka paisa, byaaj ka paisa, ya byaaj maaf (Cash/UPI/Cheque…)
- **Byaaj calculation** (har customer ke page par "Byaaj ka hisaab" tab mein poori details)
- **Dashboard**: kul baaki, kul byaaj, overdue customers, is mahine ka udhar aur vasooli
- **Khata / statement**: running balance, kisi bhi tareekh tak ka hisaab, print/PDF
- **WhatsApp reminder**: ek click mein baaki amount ka message
- **Backup**: JSON download/restore, aur saari entries Excel (CSV) mein
- Mobile aur computer dono par chalti hai

## Byaaj ke niyam

Settings mein do tareeke hain (default: **Bank CC / khata jaisa**):

### 1. Bank CC / khata jaisa (naam-jama byaaj), default

- Har **udhar** par uski tareekh se aaj (ya chuni hui tareekh) tak byaaj **judta** hai.
- Har **jama** par uski tareekh se aaj tak byaaj **ghatta** hai.
- Final baaki = udhar + udhar ka byaaj − jama − jama ka byaaj − byaaj jama/maaf.

Udaharan (2% mahina, 07-10-2026 tak):

| | Amount | Din | Byaaj |
|---|---|---|---|
| Udhar 07-09-2026 | ₹50,000 | 30 | ₹1,000 |
| Jama 17-09-2026 | ₹5,000 | 20 | ₹66.67 |
| **Final baaki** | 51,000 − 5,066.67 | | **₹45,933.33** |

Byaaj = amount × rate% ÷ 30 × din. Ye bank ke CC account ke daily balance par byaaj jaisa hi nikalta hai.

### 2. Free din ke baad (FIFO)

- Har udhar par pehle 30 din (badal sakte hain) byaaj nahi, uske baad 2% mahina.
- Jama paisa sabse purane udhar mein pehle adjust hota hai.

Rate aur din har customer ke liye alag bhi rakh sakte hain.

## Chalana

Koi server ya database nahi chahiye. Ye ek static website hai.

```bash
npm start        # http://localhost:8080 par kholein
npm test         # byaaj calculation ke tests
```

Ya bina install ke: `python3 -m http.server 8080` chala kar browser mein `http://localhost:8080` kholein.

### Online chalana (GitHub Pages, free)

Repo ki **Settings → Pages → Branch: `main` / root → Save**. Kuch minute mein app
`https://<username>.github.io/petro-pump-crm/` par khul jayegi.

## Data kahan save hota hai (zaroor padhein)

Abhi saara data **usi browser** (localStorage) mein save hota hai jisme app kholi gayi hai:

- Dusre phone/computer par data apne-aap nahi dikhega.
- Browser ka data/history clear karne par data mit sakta hai.
- Isliye **Settings → Backup download** roz ya hafte mein ek baar karein.

Ek se zyada device/staff ke liye agla step: online database (jaise Firebase ya Supabase) aur login jodna.

## Code

| File | Kaam |
|---|---|
| `index.html`, `css/style.css` | Page aur design |
| `js/app.js` | Saari screens aur forms |
| `js/store.js` | Data save/load, backup |
| `js/interest.js` | Byaaj ka calculation (pure function, tested) |
| `tests/interest.test.js` | Byaaj calculation ke tests |
