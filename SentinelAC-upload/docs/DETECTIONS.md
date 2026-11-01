# الكشوفات — Sentinel AC

## كيف يتخذ القرار

1. **سيرفر (موثّق ✅)**: السيرفر نفسه يشوف الحدث أو الحالة عن طريق OneSync، مثل الانفجارات وإنشاء الكيانات وأحداث الضرر والسرعة والصحة والسلاح. هذا دليل قوي، ويقدر يوصل للباند التلقائي.
2. **كلاينت (غير موثّق ⚠️)**: تقرير من سكربت اللاعب، والغشاش يقدر يزوّره. **ما يبند لحاله أبداً**: لو ضبطته على BAN، الباك إند ينزّله تلقائياً إلى KICK (قابل للتغيير من الإعدادات).
3. **الخطورة (Risk 0–100)**: كل كشف يضيف وزن حسب شدته (الكلاينت بنص الوزن)، والرقم يتناقص مع الوقت (نصف عمر 24 ساعة).
4. **التصعيد**: إذا وصل اللاعب لخطورة حرجة (80+) **وعنده** كشف موثّق شديد آخر 24 ساعة، يتبند تلقائياً. اللاعب اللي عنده Reputation bypass مستثنى.
5. **Cooldown**: نفس الكشف على نفس اللاعب داخل فترة التبريد يتسجّل بس، بدون تنفيذ جديد.
6. **الأدلة**: لو مفعّل "Screenshot evidence"، تنلقط صورة **قبل** الكيك أو الباند وتنربط بالكشف.
7. **الأحداث الخبيثة تنلغى**، مثل الانفجار المخفي أو الموديل الممنوع أو إعطاء سلاح لغيرك، قبل ما توصل للاعبين الثانيين (CancelEvent).

كل شي في الجداول تحت قابل للتعديل من **Detections → Configuration** لكل كشف: التفعيل، الإجراء، الشدة، العتبات، التبريد، مدة الباند، الأدلة، والاستثناءات (ACE / identifiers / resources). والتغييرات توصل للسيرفر خلال ثواني بدون ريستارت.

## الكشوفات المطبّقة (40)

### Player Protection

| المفتاح | الكشف | المصدر | الإجراء الافتراضي | الخطورة | العتبات الافتراضية |
|---|---|---|---|---|---|
| `godmode_flag` | Anti Godmode | ✅ سيرفر (موثّق) | KICK | high | samples=3 |
| `semi_godmode` | Anti Semi-Godmode | ✅ سيرفر (موثّق) | KICK | high | hits=5, windowSec=20, minDamage=10 |
| `health_limit` | Anti Infinite Health | ✅ سيرفر (موثّق) | KICK | high | maxHealth=200, samples=2 |
| `armor_limit` | Anti Infinite Armor | ✅ سيرفر (موثّق) | KICK | high | maxArmor=100, samples=2 |
| `invisible` | Anti Invisible | ✅ سيرفر (موثّق) | KICK | high | samples=3 |
| `no_ragdoll` | Anti No Ragdoll | ⚠️ كلاينت (غير موثّق) | WARN | medium | checks=3 |
| `super_jump` | Anti Super Jump | ⚠️ كلاينت (غير موثّق) | WARN | medium | height=3.5 |
| `freecam` | Anti Freecam | ⚠️ كلاينت (غير موثّق) | WARN | high | distance=40, checks=3 |
| `spectate` | Anti Spectate Abuse | ⚠️ كلاينت (غير موثّق) | WARN | high | checks=2 |

### Combat Protection

| المفتاح | الكشف | المصدر | الإجراء الافتراضي | الخطورة | العتبات الافتراضية |
|---|---|---|---|---|---|
| `weapon_blacklist` | Anti Illegal Weapon | ✅ سيرفر (موثّق) | BAN | critical | قوائم قابلة للتعديل |
| `weapon_give_event` | Anti Weapon Give (network) | ✅ سيرفر (موثّق) | BAN | critical | — |
| `damage_modifier` | Anti Weapon Damage Modifier | ✅ سيرفر (موثّق) | KICK | high | defaultMax=250 |
| `rapid_fire` | Anti Rapid Fire | ✅ سيرفر (موثّق) | KICK | high | maxPerSecond=20 |
| `impossible_range` | Anti Magic Bullet (range) | ✅ سيرفر (موثّق) | KICK | high | maxDistance=350, sniperMaxDistance=1200 |
| `weapon_mismatch` | Weapon Mismatch | ✅ سيرفر (موثّق) | LOG | medium | count=3, windowSec=30 |
| `clear_ped_tasks` | Anti Clear Ped Tasks | ✅ سيرفر (موثّق) | WARN | high | cancel=true |
| `client_damage_modifier` | Client Damage Multiplier | ⚠️ كلاينت (غير موثّق) | WARN | high | max=1 |

### Movement Protection

| المفتاح | الكشف | المصدر | الإجراء الافتراضي | الخطورة | العتبات الافتراضية |
|---|---|---|---|---|---|
| `speed_onfoot` | Anti Speed Hack / Fast Run | ✅ سيرفر (موثّق) | KICK | high | maxSpeed=14, samples=3 |
| `fly_noclip` | Anti Noclip / Fly | ✅ سيرفر (موثّق) | KICK | high | riseSpeed=3.5, samples=2 |
| `teleport` | Anti Teleport | ✅ سيرفر (موثّق) | WARN | high | onFootSpeed=150, vehicleSpeed=260, minDistance=120 |
| `vehicle_speed` | Anti Vehicle Speed Hack | ✅ سيرفر (موثّق) | KICK | high | landMax=110, airMax=170, samples=2 |

### Entity Protection

| المفتاح | الكشف | المصدر | الإجراء الافتراضي | الخطورة | العتبات الافتراضية |
|---|---|---|---|---|---|
| `blocked_model` | Blocked Entity Models | ✅ سيرفر (موثّق) | BAN | critical | قوائم قابلة للتعديل |
| `entity_spam` | Anti Entity Spam | ✅ سيرفر (موثّق) | KICK | high | windowSec=10, vehicles=8, peds=10, objects=40 |

### Explosion Protection

| المفتاح | الكشف | المصدر | الإجراء الافتراضي | الخطورة | العتبات الافتراضية |
|---|---|---|---|---|---|
| `explosion_invisible` | Invisible / Silent Explosion | ✅ سيرفر (موثّق) | BAN | critical | — |
| `explosion_damage_scale` | Explosion Damage Limit | ✅ سيرفر (موثّق) | BAN | critical | maxScale=1 |
| `explosion_blocked_type` | Blocked Explosion Types | ✅ سيرفر (موثّق) | BAN | critical | قوائم قابلة للتعديل |
| `explosion_spam` | Anti Explosion Spam | ✅ سيرفر (موثّق) | KICK | high | count=6, windowSec=5 |
| `explosion_distance` | Explosion Radius Validation | ✅ سيرفر (موثّق) | WARN | medium | maxDistance=400 |
| `ptfx_spam` | Anti Particle Spam | ✅ سيرفر (موثّق) | KICK | high | count=12, windowSec=5 |
| `projectile_spam` | Anti Projectile Spam | ✅ سيرفر (موثّق) | KICK | high | count=25, windowSec=5 |

### Event Protection

| المفتاح | الكشف | المصدر | الإجراء الافتراضي | الخطورة | العتبات الافتراضية |
|---|---|---|---|---|---|
| `honeypot_event` | Unauthorized Event Execution (trap) | ✅ سيرفر (موثّق) | BAN | critical | قوائم قابلة للتعديل |
| `event_spam` | Event Spam | ✅ سيرفر (موثّق) | KICK | high | perSecond=40, perEventPerSecond=15 |
| `event_serveronly` | Server-only Event From Client | ✅ سيرفر (موثّق) | BAN | critical | — |
| `event_invalid_args` | Invalid Event Arguments | ✅ سيرفر (موثّق) | WARN | medium | — |

### Resource Protection

| المفتاح | الكشف | المصدر | الإجراء الافتراضي | الخطورة | العتبات الافتراضية |
|---|---|---|---|---|---|
| `ac_heartbeat` | Anti-Cheat Heartbeat Lost | ✅ سيرفر (موثّق) | KICK | high | timeoutSec=60 |
| `client_resource_stop` | Client Resource Stopped | ⚠️ كلاينت (غير موثّق) | WARN | high | — |
| `unknown_client_resource` | Unknown Client Resource | ⚠️ كلاينت (غير موثّق) | WARN | high | — |

### Client Integrity

| المفتاح | الكشف | المصدر | الإجراء الافتراضي | الخطورة | العتبات الافتراضية |
|---|---|---|---|---|---|
| `client_invincible` | Client Invincibility Flag | ⚠️ كلاينت (غير موثّق) | WARN | high | checks=3 |
| `vision_modes` | Night / Thermal Vision | ⚠️ كلاينت (غير موثّق) | LOG | low | checks=3 |
| `vehicle_power` | Vehicle Power / Torque Modifier | ⚠️ كلاينت (غير موثّق) | WARN | medium | max=1 |

## طلبات ما طبّقتها، وليش

| الطلب | السبب | البديل المطبّق |
|---|---|---|
| **Anti Aimbot / Silent Aim** | السيرفر ما يعرف وين كان الكلاينت يصوّب. الكشف بالإحصاء (نسبة الهيدشوت وسرعة تبديل الهدف) يعطي إنذارات كاذبة كثيرة على اللاعبين المحترفين، وما أبي أدّعي كشف ما أقدر أثبته. | `weapon_mismatch` (ضرر بسلاح مو بيده)، و`impossible_range`، والمراجعة عن طريق Replay والمراقبة. |
| **Magic Bullet (اختراق الجدران)** | يحتاج raycast على السيرفر، وFiveM ما يوفر collision للعالم على السيرفر. | `impossible_range` يمسك الطلقات من مسافات مستحيلة. |
| **No Recoil** | الارتداد يصير محلياً على الكلاينت، وما فيه أي أثر يوصل للسيرفر. | — |
| **Infinite Ammo** | الذخيرة غير متزامنة مع السيرفر بشكل موثوق. | `rapid_fire` يمسك معدل الإطلاق المستحيل. |
| **Modified Game Files** | الريسورس ما يقدر يقرأ ملفات اللاعب. | `sv_pureLevel 1` أو `2` في server.cfg (حماية FiveM الرسمية)، وموجود في `server.cfg.example`. |
| **Lua injection (كامل)** | المنفّذات (executors) تشتغل داخل ريسورسات موجودة. | `unknown_client_resource` و`client_resource_stop` و`ac_heartbeat` (لو أوقف الغشاش الـ AC ينطرد)، و**honeypot events**، و**EventGuard**. |
| **Fast Run (منفصل)** | داخل ضمن `speed_onfoot`، اللي يقيس السرعة الأفقية من السيرفر. | `speed_onfoot` |
| **"موجود في سيرفرات غش" (Discord)** | يحتاج بوت داخل تلك السيرفرات أو قاعدة بيانات خارجية. | — |
| **بث فيديو مباشر** | يحتاج برنامج native خارج FiveM. | المراقبة بلقطات متتالية (كل 1–10 ثواني) مع التسجيل، وReplay تيليمتري. |

## تقليل الإنذارات الكاذبة (اقرأها قبل تفعيل الباند)

- **أي سكربت عندك يسوّي تيليبورت** (شقق، garages، مصاعد، سجن) لازم يستدعي `exports.AdvancedAC:AllowTeleport(source)`. افتراضياً `teleport` على **WARN** عشان كذا.
- **سكربتات green zone** اللي تخلي اللاعب invincible: أضف المنطقة في `Config.SafeZones`.
- **السيرفرات اللي فيها max health فوق 200** (بعض سيرفرات القتال): عدّل `health_limit → maxHealth`.
- **الموديلات الممنوعة** فيها مركبات عسكرية (rhino، hydra، lazer...). لو سيرفرك يسمح فيها، احذفها من القائمة.
- **Honeypot events**: ما تتفعّل إلا إذا كان الريسورس الأصلي **مو شغال**. لو غيّرت اسم ريسورس (مثلاً `qb-policejob` إلى `police`)، احذف حدثه من القائمة.
- ابدأ أول أسبوع وأكثر الكشوفات على **WARN**، راقب صفحة Detections، وبعدها ارفعها.
