# ANTI-NET ISP Manager — MikroTik User Manager على الموبايل

![Version](https://img.shields.io/badge/Version-2.0.0-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Android-green.svg)
![RouterOS](https://img.shields.io/badge/RouterOS-7.9%2B-orange.svg)

[English below ↓](#english)

تطبيق أندرويد **مستقل** لإدارة **User Manager** على راوترات مايكروتك. يشتغل على الموبايل لوحده، **بدون كمبيوتر وبدون سيرفر**: يتصل مباشرة بالراوتر عن طريق RouterOS REST API.

## المزايا

- **المشتركين**: إضافة وتعديل وحذف، وعدد الأجهزة بنفس الوقت، و**سرعة خاصة لكل مشترك** (تنحفظ بخاصية `Mikrotik-Rate-Limit` مثل WinBox)، وخصائص RADIUS، وربط بـ MAC.
- **الاشتراكات**: اشتراك جديد، وتجديد (يبدأ الآن أو بعد انتهاء الحالي)، وإلغاء، مع فلترة (فعّال، منتهي، بدون اشتراك).
- **المتصلين الآن** مع قطع اتصال حقيقي، و**سجل الجلسات**.
- **الإعدادات الفنية** (للمدير): الراوترات (NAS)، والبروفايلات والأسعار، والقيود والسرعات، وربط القيود بالبروفايلات حسب الوقت والأيام.
- **الكروت**: توليد برموز عشوائية آمنة، وتفعيلها على الراوتر، وطباعة PDF (مع الشعار واسم الشبكة بالعربي).
- **المبيعات**: سجل بكل عملية بيع، ومبيعات اليوم وآخر 7 أيام، وتصدير CSV.
- **حسابات الموظفين**: مدير، أو دعم فني، أو مشاهد فقط، والراوتر نفسه هو اللي يطبّق الصلاحيات.
- **النسخ الاحتياطي والاسترجاع**: الاسترجاع ما يحذف شي من الراوتر، ويدعم ملف `anti-net-backup.json` مال نسخة الويندوز القديمة.
- واجهة **عربي وإنجليزي** (من اليمين لليسار)، ووضع ليلي ونهاري، ومصممة لشاشة الموبايل.

## تجهيز الراوتر (مرة وحدة)

يحتاج **RouterOS 7.9 أو أحدث** مع حزمة **User Manager**. نفّذ هذه الأوامر بالـ Terminal (غيّر الشبكة `192.168.88.0/24` لشبكتك):

```
/user-manager set enabled=yes
/certificate add name=antinet-https common-name=antinet-router days-valid=3650 key-usage=digital-signature,key-encipherment,tls-server
/certificate sign antinet-https
/ip service set www-ssl certificate=antinet-https disabled=no address=192.168.88.0/24
/certificate print detail where name=antinet-https
```

الأمر الأخير يطلّع **fingerprint** الشهادة. أول مرة تدخل، التطبيق يعرض لك بصمة الشهادة، فتقارنها بهاي وتضغط "متطابقة — أثق بها".

بعدها ادخل بحساب المدير، وسوِّ حساب لكل موظف من صفحة **حسابات الموظفين** داخل التطبيق. لا تستخدم حساب `admin` الأساسي بالشغل اليومي.

## التثبيت

1. افتح تبويب **Actions** بالمستودع، واختار آخر تشغيل ناجح لـ **Build Android APK**.
2. نزّل الملف من قسم **Artifacts** (اسمه `anti-net-isp-manager-…apk`).
3. افتحه على الموبايل، ووافق على "التثبيت من مصادر غير معروفة".

> إذا اسم الملف بيه `temporary`، معناه انبنى بمفتاح توقيع مؤقت. يشتغل عادي، بس كل نسخة جديدة تحتاج تمسح القديمة قبل التثبيت (وتنمسح معها الكروت وسجل المبيعات المحفوظة على الهاتف، فسوِّ نسخة احتياطية قبلها). للتحديث بدون مسح، أضف مفتاح توقيع ثابت (شوف [مفتاح التوقيع](#مفتاح-التوقيع)).

## الأمان: شنو تغيّر عن نسخة الويندوز v1.2.0

| المشكلة بالنسخة القديمة | الحل بهذه النسخة |
|---|---|
| الصلاحيات تعتمد على هيدر `X-User-Role` يرسله المتصفح نفسه، فأي شخص يكدر يصير أدمن | كل موظف يدخل بحسابه على الراوتر، والراوتر هو اللي يتحقق من كل طلب |
| `GET /api/settings` يرجّع باسورد المايكروتك بدون تسجيل دخول | ماكو سيرفر أصلاً. كلمة المرور تبقى بالذاكرة، أو تنحفظ مشفرة بـ Android Keystore إذا اخترت "تذكّرني" |
| السيرفر مفتوح على `0.0.0.0:8000` لكل الشبكة | ماكو أي منفذ مفتوح على الهاتف |
| الاتصال بالراوتر على 8728 بدون تشفير | HTTPS مع تثبيت بصمة شهادة الراوتر. أي تغيير بالشهادة يوقف الاتصال ويحذرك من تنصت محتمل |
| باسوردات SHA-256 بدون salt، و`admin/password123` منشور | التطبيق ما يخزن باسوردات موظفين أصلاً، ويحذّر إذا دخلت بحساب `admin` |
| الكروت تتولد بـ `Math.random` | `crypto.getRandomValues` مع rejection sampling |
| الاسترجاع يمسح كل شي من الراوتر أول وبعدين يرجّع | الاسترجاع يضيف الناقص بس وما يحذف شي، والمسح الكامل ياخذ نسخة احتياطية تلقائياً قبلها |

### أخطاء وظيفية انصلحت

- **القيود (Limitations)**: النسخة القديمة كانت تحط السرعة بنفس الوقت كـ `download-limit` (وهذا حد كمية، مو سرعة)، فكتابة `10M` كانت تقطع المشترك بعد ما ينزّل 10 ميغابايت. وكمان التحميل والرفع كانوا مقلوبين. هسه: التحميل = `rate-limit-tx`، والرفع = `rate-limit-rx`، وحدود الكمية حقول منفصلة.
- **قطع الاتصال**: النسخة القديمة كانت تحذف سجل الجلسة من User Manager، وهذا ما يقطع أحد. هسه التطبيق يقطع اتصال PPP/Hotspot الفعلي.
- **التجديد**: النسخة القديمة تحذف الاشتراك القديم قبل لا تضيف الجديد، فإذا فشلت الإضافة يبقى المشترك بدون اشتراك. هسه يضيف الجديد أولاً.
- **الكروت**: إذا فشل إنشاء الاشتراك، ينحذف المستخدم اللي انخلق حتى ما يبقى حساب ناقص.
- **المتصلين الآن**: يطلب الجلسات الفعالة بس من الراوتر، بدل ما يسحب كل السجل كل كم ثانية.

## الصلاحيات

| الصلاحية | مجموعة RouterOS | شنو يكدر يسوي |
|---|---|---|
| مدير | `full` | كل شي |
| دعم فني | `antinet-support` (`read,write,test,password,api,rest-api`) | المشتركين، والاشتراكات، والجلسات، والكروت |
| مشاهد | `antinet-viewer` (`read,password,api,rest-api`) | يشوف بس |

مجموعتا الدعم والمشاهد ما بيهن Winbox ولا SSH ولا WebFig ولا `policy` ولا `sensitive`. **انتبه**: صلاحيات RouterOS عامة، مو لكل قائمة بروحها. يعني موظف الدعم يكدر بالـ API يغيّر أي إعداد يسمح به `write`، والتطبيق بس يخفي عنه الصفحات. لذلك اربط حساباتهم بعنوان الشبكة الداخلية من حقل "مسموح الدخول من".

## حدود يجب معرفتها

- **سجل المبيعات والكروت غير المفعّلة محفوظة على الهاتف نفسه**، لأن RouterOS ما بيه مكان يخزنها. إذا عندك أكثر من موظف بأكثر من هاتف، كل هاتف يحفظ مبيعاته، وتجمعها بالتصدير.
- يشتغل على **أندرويد فقط**. نسخة iPhone تحتاج جهاز Mac وحساب Apple Developer.
- تم الاختبار على راوتر وهمي يحاكي RouterOS REST API، وعلى منطق تثبيت الشهادة. **جرّبه على راوترك قبل الاعتماد عليه بالشغل.**

## التطوير

```bash
npm ci
npm test          # unit tests against mock/server.mjs (a mock RouterOS REST API)
npm run mock      # mock router on 127.0.0.1:8729 (admin/admin123, support1/support123)
npm run dev       # UI at http://127.0.0.1:5173 (proxies /rest to the mock)
npm run build     # type check + production build
npx cap sync android && (cd android && ./gradlew assembleRelease)
```

لتجربة الواجهة بالمتصفح على راوتر حقيقي: `ROUTER_URL=https://192.168.88.1 npm run dev`.

### مفتاح التوقيع

حتى تكدر تحدّث التطبيق بدون ما تمسحه، سوِّ مفتاح مرة وحدة واحفظه بمكان آمن:

```bash
keytool -genkeypair -v -keystore antinet-release.jks -alias antinet -keyalg RSA -keysize 3072 -validity 10000
base64 -w0 antinet-release.jks   # انسخ الناتج
```

بعدها بـ GitHub → Settings → Secrets and variables → Actions أضف:
`ANDROID_KEYSTORE_BASE64`، و`ANDROID_KEYSTORE_PASSWORD`، و`ANDROID_KEY_ALIAS`، و`ANDROID_KEY_PASSWORD`.

## هيكل المشروع

```
src/core/          منطق التطبيق (بدون واجهة): REST client، User Manager، الموظفين، الكروت، المبيعات، النسخ الاحتياطي
src/core/platform/ ربط Capacitor: الاتصال، التخزين، مشاركة الملفات
src/pages/         صفحات الواجهة
src/i18n/          الترجمة عربي/إنجليزي
android/…/RouterLinkPlugin.java   HTTP أصلي مع تثبيت الشهادة + Keystore
mock/server.mjs    راوتر وهمي للتطوير والاختبار
tests/             اختبارات
```

---

<a id="english"></a>

## English

Standalone Android app for **MikroTik User Manager** (RouterOS **7.9+**). It talks straight to the router's REST API. No PC, no server.

- Each staff member signs in with **their own RouterOS account**. Roles (admin, support, viewer) come from the account's group, and the router enforces every permission.
- HTTPS is verified by **pinning the router's certificate fingerprint**, which the user confirms on first connect (trust on first use). A changed certificate stops the connection.
- Passwords are never stored unless the user picks "remember", and then only encrypted with an Android Keystore AES-GCM key. Backups are disabled.
- Pages: subscribers, subscriptions (new, renew now or queued, cancel), live sessions with a real PPP/Hotspot disconnect, session history, NAS routers, profiles, limitations, profile limits, vouchers (secure generation, push to the router, PDF), sales log with CSV export, staff accounts, backup and merge restore (imports v1 Windows backups too), and erase with an automatic safety backup.
- Arabic (RTL) and English, dark and light theme.

**Router setup:** run the commands in the Arabic section above. They enable User Manager, create a self-signed HTTPS certificate, enable `www-ssl` for the LAN only, and print the fingerprint.

**Install:** download the APK from the latest successful **Build Android APK** run under **Actions → Artifacts**. Add the `ANDROID_KEYSTORE_*` secrets to get stable-signed builds that can update in place.

**Limits:** the sales log and unsold vouchers are stored per phone, because RouterOS has no place to keep them. RouterOS policies are not per-menu, so support staff could use the API outside the app; restrict them with the allowed-address field. Tested against a mock RouterOS REST API and on the JVM for certificate pinning. Verify it on your own router before relying on it.

**v1.2.0 (Windows) is superseded.** Its local server trusted a client-sent `X-User-Role` header, served the router password unauthenticated on `0.0.0.0:8000`, and set speed values as byte quotas. Do not keep it running on a shared network.
