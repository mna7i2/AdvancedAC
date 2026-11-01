# الاختبار — Sentinel AC

## اللي انختبر عندي (133 اختبار آلي، كلها ناجحة على تثبيت نظيف)

| المجموعة | العدد | الملف | وش تغطي |
|---|---|---|---|
| Unit — منطق القرار | 11 | `backend/test/*.test.js` | قواعد الباند، تنزيل إشارات الكلاينت، التصعيد، الكتالوج، تنظيف الإعدادات، تشفير Discord و retry، سلسلة التدقيق |
| EventGuard | 7 | `tests/unit/eventguard_test.py` | rate limit، server-only، validate، عدم حظر أحداث السيرفر |
| المرحلة 2 — الاتصال | 36 | `tests/sim/scenarios/stage2_connection.lua` | handshake، الجلسات، التيليمتري، الأوامر، الباند والطرد، كاش الباند والسيرفر offline، الترخيص |
| المرحلة 3/4 — الكشف والتنفيذ | 53 | `tests/sim/scenarios/stage3_detections.lua` | كل كشوفات السيرفر، الإلغاء، الأدلة قبل الطرد، Safe zones، bypass، التصعيد، heartbeat، صلاحيات القائمة |
| المرحلة 6: الحقيبة وقواعد الحماية | 17 | `tests/sim/scenarios/stage6_features.lua` | حقيبة ESX، حظر exploit من الموقع، الحماية من الإنذارات الكاذبة، مستويات القوة |
| الوضع المحلي بدون باك إند | 8 | `tests/sim/scenarios/local_only.lua` | الحماية تشتغل من أول تشغيل بدون موقع |
| لوحة `/adv` | 5 | `tests/sim/scenarios/panel_session.lua` | جلسة اللوحة داخل اللعبة للطاقم المربوط فقط |
| الأمان | 26 | `tests/api/security_test.py` | عزل المنظمات، الصلاحيات، منع رفع الصلاحيات، CSRF، الجلسات، مفاتيح السيرفر، سلامة سجل التدقيق |

بالإضافة: اختبار متصفح حقيقي (Chromium) لكل صفحات الداشبورد مع سيرفر "حي". الأزرار نفّذت أوامر فعلية ورجعت النتيجة: Screenshot، Freeze/Unfreeze، المراقبة، Replay، Console، وحفظ الإعدادات ووصولها للسيرفر بدون ريستارت. وانختبرت قائمة `/adv` كمان، ومعها اختبار XSS باسم لاعب خبيث.

### كيف انختبر كود Lua بدون FiveM

ما قدرت أشغّل FXServer في بيئة العمل (الرابط محجوب، وما فيه عميل GTA). فـ `tests/sim/` يشغّل **نفس ملفات الريسورس الفعلية** داخل Lua 5.4، مع محاكي لبيئة FiveM: natives السيرفر، الأحداث، deferrals، KVP، وPerformHttpRequest موصول بالباك إند الحقيقي. السيناريوهات تولّد أحداث OneSync نفسها (`explosionEvent` و`entityCreating` و`weaponDamageEvent`...) بنفس الحقول اللي يرسلها FXServer.

**حدود هذا الاختبار:** ما يثبت إن natives FiveM ترجع بالضبط القيم المتوقعة في كل الحالات، وما يشغّل كود الكلاينت (`client/*.lua`). كود الكلاينت انفحص بالـ compile، وكل native فيه انطابق مع قائمة natives الرسمية. عشان كذا الاختبار داخل اللعبة تحت **ضروري**.

### تشغيل الاختبارات

```bash
cd backend && npm test                                  # unit
python3 tests/unit/eventguard_test.py
pip install lupa pillow
python3 tests/sim/run.py tests/sim/scenarios/stage2_connection.lua
python3 tests/sim/run.py tests/sim/scenarios/stage3_detections.lua
python3 tests/api/security_test.py
```

> اختبارات `tests/` تنشئ سيرفرات ولاعبين تجريبيين في القاعدة، فشغّلها على قاعدة بيانات تطوير، **مو** على قاعدة الإنتاج.

---

## ✅ قائمة الاختبار داخل اللعبة (سوّها على سيرفر تجريبي قبل الإنتاج)

خلّ كل الكشوفات على **WARN** أثناء الاختبار، من Detections → Configuration → اختر كشف → Action.

### الاتصال
- [ ] الكونسول يطبع: `Connected to backend as "..."`
- [ ] الداشبورد: السيرفر **Online**، وعدد اللاعبين صحيح.
- [ ] تدخل اللعبة وتطلع في **Players** بالـ health والسلاح والإحداثيات، وتتحدث كل ثانيتين.
- [ ] **Live Map**: موقعك يتحرك.
- [ ] **Server Console**: السطور تظهر، والأمر `status` يشتغل.

### القائمة `/adv`
- [ ] تنفتح للأدمن (`sentinel.admin`)، وما تنفتح للاعب عادي.
- [ ] Spectate (Backspace للخروج)، Screenshot، Freeze، Heal، Go to، Bring، Kick، Ban، Unban.
- [ ] كل إجراء يظهر في **Audit Logs**.

### الكشوفات (بلاعب ثاني بدون bypass)
- [ ] `/tp` بسكربت ما يستدعي AllowTeleport ← كشف **teleport** (WARN).
- [ ] نفس السكربت مع `exports.AdvancedAC:AllowTeleport(source)` ← ما فيه كشف.
- [ ] سيارة بسرعة طبيعية عالية (300 كم/س) ← **ما فيه** كشف `vehicle_speed`.
- [ ] السقوط من مكان عالي، الباراشوت، السلالم ← ما فيه كشف.
- [ ] الموت ثم الإحياء من سكربت الإسعاف ← ما فيه كشف صحة أو تيليبورت.
- [ ] Green zone (لو عندك): أضفها في `Config.SafeZones` ← ما فيه كشف godmode.
- [ ] أعطِ لاعب سلاح `WEAPON_RAILGUN` من سكربت سيرفر ← كشف **weapon_blacklist**.
- [ ] Screenshot من الداشبورد ← الصورة تظهر في Evidence Center.
- [ ] Monitoring: شغّل مراقبة لاعب ← الإطارات تتحدث.

### الباند
- [ ] Ban من الداشبورد ← اللاعب ينطرد فوراً والرسالة فيها Ban ID.
- [ ] يحاول يدخل مرة ثانية ← مرفوض.
- [ ] Unban ← يقدر يدخل.
- [ ] طفّ الباك إند ← اللاعب المبند **ما يقدر يدخل** (من الكاش المحلي)، والسيرفر يكمل يشتغل.
- [ ] رجّع الباك إند ← يرجع يتصل لحاله.
- [ ] صفحة `/appeal.html` ← قدّم استئناف ← يظهر في Bans → Appeals.

### Discord
- [ ] اربط Webhook في Discord Integration ← Test ← توصل الرسالة.

### الأداء
- [ ] `resmon` في F8: الريسورس AdvancedAC (server + client) يكون تحت **0.10 ms** في الوضع العادي.

**لو أي كشف طلّع إنذار كاذب**، أرسل لي اسم الكشف والـ details من صفحة Detections (تفتح بالضغط على الكشف)، وأعدّل العتبة أو المنطق.
