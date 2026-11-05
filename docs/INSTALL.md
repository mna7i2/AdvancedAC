# دليل التثبيت — Sentinel AC

النظام فيه ثلاثة أجزاء، وكلها لازم تشتغل:

| الجزء | المجلد | يشتغل على |
|---|---|---|
| الباك إند + الداشبورد | `backend/` | نفس جهاز السيرفر أو VPS (Node.js + PostgreSQL) |
| ريسورس FiveM | `resource/AdvancedAC/` | داخل `resources` في سيرفرك |
| screenshot-basic | (ريسورس رسمي من Cfx.re) | داخل `resources` — مطلوب للأدلة والمراقبة |

---

## 1) تثبيت المتطلبات (Windows)

1. **Node.js 20 أو أحدث** — من nodejs.org (نسخة LTS).
2. **PostgreSQL 16** — من postgresql.org. أثناء التثبيت احفظ كلمة سر المستخدم `postgres`.
3. افتح **SQL Shell (psql)** وسوّ قاعدة البيانات:
   ```sql
   CREATE USER sentinel WITH PASSWORD 'اكتب_كلمة_سر_قوية';
   CREATE DATABASE sentinel OWNER sentinel;
   ```

## 2) إعداد الباك إند

افتح CMD داخل مجلد `backend`:

```bat
npm install --omit=dev
copy .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

افتح `.env` وعدّل:
- `DATABASE_URL=postgres://sentinel:كلمة_السر@127.0.0.1:5432/sentinel`
- `APP_SECRET=` ← الصق الناتج من الأمر الأخير. **لا تغيّره أبداً بعد أول تشغيل** (يشفّر روابط الديسكورد ويوقّع سجل التدقيق).
- `PUBLIC_URL=` ← رابط الداشبورد اللي بتفتحه (مثلاً `http://localhost:8080` أو دومينك).

أنشئ المنظمة وحساب المالك والترخيص:

```bat
node src\cli.js org:create --name "اسم سيرفرك" --email you@example.com --owner "Hamad" --password "كلمة_سر_10_أحرف_مع_أرقام" --servers 1
```

شغّل الباك إند:

```bat
start.bat
```

افتح `http://localhost:8080` وسجّل دخول بالإيميل وكلمة السر.

> **لتشغيله دائماً كخدمة على Windows:** استخدم NSSM (`nssm install SentinelAC "C:\Program Files\nodejs\node.exe" "C:\...\backend\src\index.js"`) أو pm2.

## 3) إضافة السيرفر في الداشبورد

1. **Server Management → Add server** ← اكتب الاسم.
2. ينعرض لك **API key مرة وحدة بس** مع سطور `server.cfg` جاهزة. انسخها.

## 4) تثبيت الريسورس

1. انسخ مجلد `AdvancedAC` إلى `resources` في سيرفرك.
2. ثبّت `screenshot-basic` (github.com/citizenfx/screenshot-basic) في `resources`.
3. أضف إلى `server.cfg` (النموذج الكامل في `resource/server.cfg.example`):

```cfg
set onesync on
set sentinel_backend "http://127.0.0.1:8080"
set sentinel_api_key "sac_srv_..."
add_ace resource.AdvancedAC command allow
add_ace group.admin sentinel.admin allow
add_ace group.admin sentinel.bypass allow
ensure screenshot-basic
ensure AdvancedAC
```

⚠️ استخدم `set` وليس `sets`، لأن `sets` يخلّي المفتاح ظاهر للاعبين.

4. شغّل السيرفر. في الكونسول بيطلع لك:
   `[Sentinel AC] Connected to backend as "..." | X players | Y bans cached`
   وفي الداشبورد يصير السيرفر **Online** خلال ثواني.

أول اتصال **يربط المفتاح بسيرفرك** (fingerprint = رابط cfx.re)، فلو أحد سرق المفتاح ما يقدر يستخدمه في سيرفر ثاني. إذا نقلت السيرفر لجهاز جديد: **Server Management → Reset binding**.

## 5) الطاقم (Staff)

- **داخل اللعبة:** أي لاعب عنده `sentinel.admin` يقدر يفتح القائمة بـ `/adv` (أو F10).
- **صلاحيات دقيقة:** `add_ace group.mod sentinel.perm.players.kick allow` (أسماء الصلاحيات موجودة في صفحة Administrators).
- **ربط حساب الداشبورد باللاعب:** في **Administrators → Edit → Linked in-game identifiers** حط `license:...` حقك. بعدها:
  - صلاحيات دورك في الداشبورد تنطبق عليك داخل اللعبة تلقائياً.
  - أزرار **Go to / Bring** في الداشبورد تشتغل (لازم تكون داخل السيرفر).
- **`sentinel.bypass`**: الطاقم اللي يستخدم noclip أو godmode أو قائمة txAdmin ما ينكشف. أعطه للأدمنية بس.
- **اللوحة الكاملة داخل اللعبة (`/adv`)**: لو ربطت الـ identifier حقك بحسابك في الداشبورد، يفتح لك `/adv` **نفس الموقع بالضبط** داخل اللعبة، بدون تسجيل دخول، وبنفس صلاحياتك، ومعه Spectate. ولو ما ربطته يفتح لك القائمة السريعة.
- **حقيبة اللاعب**: ملف اللاعب ← تبويب **Inventory** (صلاحية `players.inventory`). يدعم ESX و QBCore و Qbox و ox_inventory.
- **Protection Rules** في الموقع: تختار قوة الحماية بضغطة (Relaxed / Balanced / Strict / Maximum)، وتحظر أي event أو سلاح أو موديل أو نوع انفجار، والتغيير يطبّق فوراً على كل السيرفرات.

## 6) توافق txAdmin

- يشتغل مع txAdmin وFXServer العادي بدون أي تعديل.
- أدوات txAdmin (noclip، heal، tp) تُعتبر طبيعية للي عندهم `sentinel.bypass`.
- لما txAdmin يعيد تشغيل السيرفر، الريسورس يقفل الجلسات بشكل نظيف ويرجع يتصل تلقائياً.

## 7) دمج مع سكربتاتك (مهم لتقليل الإنذارات الكاذبة)

```lua
-- قبل أي تيليبورت من سكربتك (شقق، مصاعد، garages):
exports.AdvancedAC:AllowTeleport(source)
-- قبل إحياء أو heal أو تغيير صحة من السيرفر:
exports.AdvancedAC:SetGrace(source, 'health', 3000)
-- كشف مخصص من سكربتك:
exports.AdvancedAC:Report(source, 'honeypot_event', { event = 'my:event' })
```

**حماية أحداث سكربتاتك (EventGuard):** أضف السطر هذا كأول سكربت سيرفر في أي ريسورس تبي تحميه:

```lua
server_scripts { '@AdvancedAC/shared/eventguard.lua', 'server/main.lua' }
```

وبعدها في كود السيرفر حقك:

```lua
Guard.serverOnly('myjob:server:pay')           -- لو جا من كلاينت = غش واضح
Guard.validate('shop:buy', function(item, n)    -- رفض المدخلات الغلط
    return type(item) == 'string' and math.type(n) == 'integer' and n > 0 and n <= 100
end)
```

**المناطق الآمنة:** إذا عندك سكربت green zone يخلي اللاعبين invincible، أضف المنطقة في `config/config.lua` ← `Config.SafeZones`.

## 8) خريطة GTA

صورة الخريطة ما هي مرفقة لأنها ملك Rockstar. حط صورتك في `backend/public/assets/map/gtav.jpg`، وبعدها اضبط حدود العالم من **Settings → Map**. وإذا ما حطيت صورة، الخريطة تنرسم كشبكة إحداثيات، والمواقع تبقى دقيقة.

## 9) الأمان في الإنتاج

- لو الباك إند على **جهاز غير جهاز السيرفر**: لازم **HTTPS**. حطه خلف Caddy أو nginx أو Cloudflare Tunnel، وفعّل `TRUST_PROXY=1`، وخلّ `sentinel_backend` يبدأ بـ `https://`.
- لا تفتح منفذ PostgreSQL (5432) للإنترنت.
- خذ نسخة احتياطية من قاعدة البيانات ومجلد `backend/storage/evidence` بشكل دوري.

## 10) أوامر الإدارة (CLI)

```bat
node src\cli.js license:create --org <orgId> --servers 3 --days 30
node src\cli.js license:revoke --prefix SAC-ABCD
node src\cli.js audit:verify --org <orgId>
```

## بيع الحماية للعملاء (لوحة البائع)

- أول حساب انسوى في الموقع هو حساب البائع. تلقى له في القائمة الجانبية قسم **Sentinel Business** ← **Customers**. وتقدر تعطي حساب ثاني نفس الصلاحية بالأمر `node src/cli.js platform:grant --email x@y.com`، أو بمتغير البيئة `PLATFORM_ADMIN_EMAILS`.
- **New customer**: تكتب اسم السيرفر بس، والنظام يسوي لحاله ثلاث أشياء:
  - إيميل دخول على اسم السيرفر، وكلمة سر قوية.
  - ترخيص بالمدة وعدد السيرفرات اللي تختارها.
  - سيرفر جاهز، مع أسطر `server.cfg` اللي ترسلها للعميل.
- تشوف لكل عميل:
  - السيرفرات الشغالة وعدد اللاعبين.
  - المشاكل، مثل: السيرفر أوفلاين، OneSync مطفي، screenshot-basic مو شغال، نسخة قديمة، الترخيص قرب ينتهي، أو أداة الحماية عند اللاعبين ما تشتغل.
- **Manage dashboard**: تدخل لوحة العميل بتحكم كامل، وكل اللي تسويه ينسجل في سجل العميل باسم "Sentinel support".
- **Suspend**: العميل ما يقدر يسجل دخول، والحماية في سيرفره تطفى خلال دقيقة. وأول ما ترجعه (**Re-activate**) ترجع الحماية بدون ريستارت.

**قبل البيع:**
- خطة Render المجانية ما تنفع للعملاء: قاعدة البيانات تنحذف بعد 30 يوم، وملفات الأدلة تضيع مع كل ريستارت. لازم خطة مدفوعة، Starter أو أعلى، وقاعدة بيانات مدفوعة.
- شفّر ملفات السيرفر حق الحماية بنظام **Cfx Asset Escrow** (Keymaster / Tebex)، عشان العميل ما يقدر يعدّل الكود ويشيل الترخيص. خل `config/config.lua` بدون تشفير عشان يقدر يضبط الإعدادات.

## البند المستحق (Fair bans)

- كل تحذير وطرد وبند ينحفظ معه السبب المقاس بالأرقام، مثال: "Ran at 38.2 m/s — limit 14 m/s, 3 samples in a row". هذا يطلع للاعب في رسالة البند، وللإدارة في صفحة البند، وفي الديسكورد.
- لما اللاعب يوصل لخطر عالي، الافتراضي إنه **ينطرد ويروح للمراجعة** (Bans ← Ban review)، والإدارة تقرر البند. ما يتبند تلقائياً.
- الكشوفات اللي ممكن يسببها اللاق، مثل التيليبورت ونبض الحماية وبعد الانفجار، ما تعتبر دليل للبند أبداً.
- **Protection Control**: صفحة وحدة تتحكم فيها بكل كشف:
  - تشغيل وإطفاء.
  - العقوبة: Log / Warn / Kick / Kick + review / Ban.
  - مدة البند.
  - خطة عقوبات حسب المرة، مثل: أول مرة طرد ← ثاني مرة طرد ← ثالث مرة مراجعة.

## ملفات جاهزة لكل عميل (مربوطة بالسيرفر والآيبي)

- من صفحة العميل ← **Download files**: يطلع لك ملف `.zip` فيه مجلد `AdvancedAC` كامل.
- داخل المجلد ملف `server/license.lua`، وفيه ثلاث أشياء: عنوان الموقع، ومفتاح السيرفر، والترخيص. فالعميل ما يحط أي مفتاح في `server.cfg`، يكفيه `ensure AdvancedAC`.
- **IP lock**: المفتاح يشتغل بس من آيبي سيرفر العميل.
  - لو تركت خانة الآيبي فاضية، ينقفل لحاله على أول آيبي يتصل.
  - لو انسخت الملفات لسيرفر ثاني، تنرفض والحماية تطفى.
- نسخة العميل ما تشتغل بدون `license.lua`، ما فيها وضع "حماية محلية".
- كل مرة تضغط Download files يتسوى مفتاح جديد، والملفات القديمة تتعطل. إلا إذا نزلتها مباشرة بعد إنشاء العميل.
- بعد أي تعديل على ملفات الحماية، شغّل: `npm run build:nui && npm run build:template`، وارفع `src/assets/resource-template.json` مع الموقع.
