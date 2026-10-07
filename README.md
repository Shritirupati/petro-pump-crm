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

Settings mein badal sakte hain (aur har customer ke liye alag bhi):

| Niyam | Default |
|---|---|
| Byaaj rate | 2% per mahina (simple interest, 1 mahina = 30 din) |
| Byaaj-free din | 30 din (har udhar ki tareekh se) |
| Jama paisa | Sabse purane udhar mein pehle adjust hota hai (FIFO) |

Udaharan: 1 Jan ko ₹10,000 udhar, 1 April tak nahi chukaya = 90 din.
Pehle 30 din free, baaki 60 din ka byaaj = 10,000 × 2% ÷ 30 × 60 = **₹400**.

Agar beech mein kuch paisa jama hua, to jitna hissa chukaya gaya uska byaaj usi din ruk jaata hai.

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
