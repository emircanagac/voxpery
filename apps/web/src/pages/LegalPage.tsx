import { Link, useLocation } from 'react-router'
import { PUBLISHED_LEGAL_VERSION } from '../legal'
import { ROUTES } from '../routes'
import { usePublicPageMetadata } from './publicPageMetadata'

// Keep these texts identical to docs/PRIVACY_NOTICE.md, docs/TERMS_OF_SERVICE.md and
// docs/KVKK_AYDINLATMA_METNI.md. A content change needs a new PUBLISHED_LEGAL_VERSION (and the
// server's CURRENT_*_VERSION), which asks every user to acknowledge it again.
const UPDATED_AT = '23 October 2026'
const UPDATED_AT_TR = '23 Ekim 2026'
const CONTACT = 'voxpery@gmail.com'

function EnglishPrivacyNotice() {
  return <>
    <h1>Privacy Notice</h1>
    <p><strong>Version:</strong> {PUBLISHED_LEGAL_VERSION} · <strong>Last updated:</strong> {UPDATED_AT}</p>
    <p>This notice applies only to the official hosted service at voxpery.com, on the web and in the desktop apps. Anyone who runs their own Voxpery server is a separate controller and must publish their own notice.</p>
    <h2>Controller and contact</h2>
    <p>The hosted service is operated by Emircan Agac, an individual open-source project operator in Türkiye. Send privacy questions and requests to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
    <h2>Data we process</h2>
    <ul>
      <li><strong>Account and profile:</strong> username, email address, password hash, profile picture, optional about-me text, online status, preferences such as who can send you direct messages, your Google account identifier if you sign in with Google, whether your email is verified, and which versions of these documents you accepted and when.</li>
      <li><strong>Communities and messages:</strong> servers, memberships and roles, friends and friend requests, messages and direct messages, reactions, pins, uploaded files, reports, bans, timeouts and server audit log entries. Location and camera metadata is removed from uploaded JPEG and PNG images.</li>
      <li><strong>Security and operations:</strong> your sign-in session, short-lived rate-limit counters that include your IP address, server logs, and a record of when your account was registered and when you exported your data. IP addresses are not stored in the database.</li>
      <li><strong>Voice, video and screen sharing:</strong> carried in real time through the LiveKit media server that the operator runs with the service. Calls, cameras and screen shares are not recorded.</li>
    </ul>
    <h2>Messages are not end-to-end encrypted</h2>
    <p>Messages, direct messages and files are not end-to-end encrypted. The hosted server stores them and can technically access them for delivery, data export, abuse handling, security and lawful requests. Do not use Voxpery for secrets that need end-to-end encryption.</p>
    <h2>Purposes and legal bases</h2>
    <p>Data is used to create and secure accounts, provide communication features, prevent abuse, operate and troubleshoot the service, comply with the law, and establish or defend legal claims. Processing relies on performing the Terms of Service, legitimate interests in running a safe service, and legal obligations. Voxpery does not use your data for advertising or profiling.</p>
    <h2>Cookies and local storage</h2>
    <p>The web app uses one sign-in cookie, which keeps you signed in until you sign out or the session expires, and short-lived cookies during Google or desktop sign-up. The desktop app keeps its sign-in in your operating system's credential store. Your browser's local storage holds settings such as theme, notification and voice preferences, and unsent message drafts; this stays on your device. Cloudflare may set cookies needed to protect the service from attacks. Voxpery uses no advertising or analytics cookies.</p>
    <h2>Service providers and international transfers</h2>
    <ul>
      <li><strong>Hosting:</strong> the servers, database and media server run in Germany.</li>
      <li><strong>Cloudflare:</strong> network delivery, attack protection and the human check (Turnstile) at sign-up. Cloudflare sees your IP address and request data.</li>
      <li><strong>Google:</strong> optional Google sign-in, and delivery of account emails such as email verification and password reset.</li>
      <li><strong>GIPHY and jsDelivr:</strong> GIF search goes from your device directly to GIPHY, and GIPHY GIFs in chat load directly from GIPHY. Built-in stickers load from the jsDelivr network. Both see the IP address of everyone who searches or views them. Images from other websites shown in chat are loaded through Voxpery's server, so those websites do not see your IP address.</li>
      <li><strong>GitHub:</strong> the desktop apps check for and download updates from GitHub, which sees your device's IP address.</li>
    </ul>
    <p>Data is therefore processed in Germany and, by these providers, in other countries including the United States. Transfers rely on the safeguards available under applicable law, such as the providers' data processing terms and standard contractual clauses.</p>
    <h2>Retention</h2>
    <ul>
      <li>Account data and content are kept until you delete them or your account.</li>
      <li>Deleting your account immediately deletes your profile, messages, direct messages, reactions, friendships, memberships and uploaded files. Moderation and audit records you created are reassigned to a placeholder account, and servers you own pass to their highest-ranked member.</li>
      <li>Server logs and database backups are kept for at most 14 days, so deleted data also leaves backups within 14 days.</li>
      <li>Rate-limit counters and unfinished sign-ups expire on their own, within minutes to hours.</li>
    </ul>
    <h2>Your rights</h2>
    <p>Depending on where you live, you may ask for access to, correction, deletion or portability of your data, restrict or object to processing, and complain to a data protection authority. Settings offer a ZIP export of your data (your latest 20,000 server messages and 20,000 direct messages, and your files); it is a convenience, not a complete answer to a formal access request. Send formal requests from the email address on your account to the contact above; you will get an answer within 30 days.</p>
    <h2>Children</h2>
    <p>The hosted service is for people aged 13 or over. In countries where a higher age applies to consent for online services, you need that age or your parent's or guardian's consent.</p>
    <h2>Changes and incidents</h2>
    <p>Changes are versioned. When a document changes, you are asked to acknowledge the new version the next time you use Voxpery. Report suspected personal data incidents to the contact above.</p>
  </>
}

function TermsOfService() {
  return <>
    <h1>Terms of Service</h1>
    <p><strong>Version:</strong> {PUBLISHED_LEGAL_VERSION} · <strong>Last updated:</strong> {UPDATED_AT}</p>
    <p>These Terms govern the official hosted Voxpery service at voxpery.com, on the web and in the desktop apps. The source code is licensed separately under AGPL-3.0-only.</p>
    <h2>Eligibility and accounts</h2>
    <p>You must be at least 13 years old, or older where your country requires a higher age for online services, and able to accept these Terms. Provide accurate account information. You are responsible for your credentials and for activity on your account.</p>
    <h2>Acceptable use</h2>
    <p>Do not abuse, harass or threaten others, exploit minors, distribute malware, evade access controls or bans, infringe others' rights, overload the service, send automated spam, or use Voxpery for unlawful content or activity. Rate and storage limits apply.</p>
    <h2>Your content</h2>
    <p>You keep the rights to your content. You give the operator the limited permission needed to store, process, transmit, moderate and back up it in order to run and secure the service. You are responsible for having the right to share it.</p>
    <h2>Moderation and availability</h2>
    <p>Content or accounts may be restricted when necessary for safety, the law, security or service integrity. Server owners and moderators can also moderate their own servers. Voxpery is an early-stage service run by a volunteer, without guaranteed uptime. Features may change, and the service may be suspended or ended with notice where practical.</p>
    <h2>Privacy, ending your account and liability</h2>
    <p>The <Link to={ROUTES.privacy}>Privacy Notice</Link> explains how data is processed. You can end this agreement at any time by deleting your account in Settings. To the extent the law allows, the service is provided as-is without warranties, and the operator is not liable for indirect or consequential losses. Mandatory consumer rights are not affected.</p>
    <h2>Changes</h2>
    <p>When these Terms change, you are asked to accept the new version before you continue using the service.</p>
    <h2>Contact</h2>
    <p>Questions about these Terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
  </>
}

function KvkkNotice() {
  return <>
    <h1>KVKK Aydınlatma Metni</h1>
    <p><strong>Sürüm:</strong> {PUBLISHED_LEGAL_VERSION} · <strong>Son güncelleme:</strong> {UPDATED_AT_TR}</p>
    <p>Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun (KVKK) 10. maddesi uyarınca hazırlanmıştır ve yalnızca voxpery.com adresindeki resmî barındırılan hizmet (web ve masaüstü uygulamaları) için geçerlidir. Kendi Voxpery sunucusunu işletenler, kendi veri işleme faaliyetlerinin ayrı veri sorumlusudur.</p>
    <h2>Veri sorumlusu</h2>
    <p>Barındırılan hizmetin veri sorumlusu, Türkiye'de bireysel açık kaynak proje işletmecisi olarak Emircan Agac'tır. İletişim: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
    <h2>İşlenen kişisel veriler</h2>
    <ul>
      <li><strong>Kimlik ve iletişim:</strong> kullanıcı adı, e-posta adresi, Google ile giriş yapılırsa Google hesap kimliği.</li>
      <li><strong>Hesap ve profil:</strong> parola özeti (hash), profil resmi, isteğe bağlı "hakkımda" metni, çevrim içi durumu, tercihler, e-postanın doğrulanıp doğrulanmadığı, kabul edilen metinlerin sürümleri ve kabul zamanları.</li>
      <li><strong>Topluluk ve iletişim içeriği:</strong> sunucular, üyelikler ve roller, arkadaşlıklar ve istekler, mesajlar ve doğrudan mesajlar, tepkiler, sabitlemeler, yüklenen dosyalar, şikâyetler, yasaklar, susturmalar ve sunucu denetim kayıtları. Yüklenen JPEG ve PNG resimlerdeki konum ve kamera bilgileri silinir.</li>
      <li><strong>İşlem güvenliği:</strong> oturum bilgisi, IP adresini içeren kısa ömürlü istek sınırı sayaçları, sunucu kayıtları (log), hesabın oluşturulma ve veri dışa aktarma zamanları. IP adresleri veri tabanında saklanmaz.</li>
      <li><strong>Ses, görüntü ve ekran paylaşımı:</strong> işletmecinin hizmetle birlikte çalıştırdığı LiveKit medya sunucusu üzerinden anlık iletilir; görüşmeler kaydedilmez.</li>
    </ul>
    <p>Mesajlar, doğrudan mesajlar ve dosyalar uçtan uca şifreli değildir; sunucu bunları saklar ve teknik olarak erişebilir.</p>
    <h2>Toplama yöntemi ve hukuki sebepler</h2>
    <p>Kişisel veriler; hesap oluşturma ve uygulamanın kullanımı sırasında sizin girdiğiniz bilgilerden ve hizmetin çalışması için gereken otomatik yollardan (oturum çerezi, sunucu kayıtları) elektronik ortamda toplanır. Veriler KVKK m.5/2 kapsamında sözleşmenin kurulması ve ifası (c), veri sorumlusunun hukuki yükümlülüğü (ç), bir hakkın tesisi, kullanılması veya korunması (e) ve temel hak ve özgürlüklerinize zarar vermemek kaydıyla veri sorumlusunun meşru menfaati (f) hukuki sebeplerine dayanılarak işlenir. Veriler reklam veya profilleme için kullanılmaz.</p>
    <h2>İşleme amaçları</h2>
    <p>Hesabın oluşturulması ve güvenliği, iletişim özelliklerinin sunulması, kötüye kullanımın önlenmesi, hizmetin işletilmesi ve hataların giderilmesi, mevzuattan doğan yükümlülüklerin yerine getirilmesi ve hukuki uyuşmazlıklarda hakların korunması.</p>
    <h2>Çerezler ve yerel depolama</h2>
    <p>Web uygulaması oturumu açık tutan tek bir oturum çerezi ve Google ya da masaüstü kayıt sırasında kısa ömürlü çerezler kullanır. Masaüstü uygulaması oturumu işletim sisteminin kimlik bilgisi deposunda tutar. Tarayıcının yerel depolaması tema, bildirim ve ses tercihleri ile gönderilmemiş mesaj taslaklarını cihazınızda saklar. Cloudflare, hizmeti saldırılara karşı korumak için gerekli çerezler kullanabilir. Reklam veya analiz çerezi kullanılmaz.</p>
    <h2>Aktarılan taraflar ve yurt dışına aktarım</h2>
    <ul>
      <li><strong>Barındırma:</strong> sunucular, veri tabanı ve medya sunucusu Almanya'dadır.</li>
      <li><strong>Cloudflare:</strong> ağ dağıtımı, saldırı koruması ve kayıttaki insan doğrulaması (Turnstile); IP adresinizi ve istek bilgilerini görür.</li>
      <li><strong>Google:</strong> isteğe bağlı Google ile giriş ve e-posta doğrulama ile parola sıfırlama gibi hesap e-postalarının gönderimi.</li>
      <li><strong>GIPHY ve jsDelivr:</strong> GIF araması cihazınızdan doğrudan GIPHY'ye gider ve sohbetteki GIPHY GIF'leri doğrudan GIPHY'den yüklenir. Hazır çıkartmalar jsDelivr ağından yüklenir. Her ikisi de arayan veya görüntüleyen herkesin IP adresini görür. Sohbette gösterilen diğer sitelerin resimleri Voxpery sunucusu üzerinden yüklenir, o siteler IP adresinizi görmez.</li>
      <li><strong>GitHub:</strong> masaüstü uygulamaları güncellemeleri GitHub'dan denetler ve indirir; GitHub cihazınızın IP adresini görür.</li>
    </ul>
    <p>Bu nedenle kişisel verileriniz yurt dışına (Almanya'ya ve bu sağlayıcılar aracılığıyla ABD dahil diğer ülkelere) aktarılır. Aktarımlar KVKK m.9'da öngörülen aktarım mekanizmalarına dayanılarak yapılır.</p>
    <h2>Saklama süreleri</h2>
    <ul>
      <li>Hesap verileri ve içerik, siz ya da hesabınız silinene kadar saklanır.</li>
      <li>Hesap silindiğinde profil, mesajlar, doğrudan mesajlar, tepkiler, arkadaşlıklar, üyelikler ve yüklenen dosyalar hemen silinir. Oluşturduğunuz moderasyon ve denetim kayıtları bir yer tutucu hesaba aktarılarak kalır; sahibi olduğunuz sunucular en yüksek rütbeli üyeye geçer.</li>
      <li>Sunucu kayıtları ve veri tabanı yedekleri en fazla 14 gün tutulur; silinen veriler yedeklerden de 14 gün içinde çıkar.</li>
      <li>İstek sınırı sayaçları ve tamamlanmayan kayıtlar dakikalar ile saatler içinde kendiliğinden silinir.</li>
    </ul>
    <h2>KVKK m.11 kapsamındaki haklarınız</h2>
    <p>Veri sorumlusuna başvurarak; kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini isteme, KVKK m.7 çerçevesinde silinmesini veya yok edilmesini isteme, düzeltme ve silme işlemlerinin aktarıldığı üçüncü kişilere bildirilmesini isteme, münhasıran otomatik sistemlerle analiz edilmesi sonucu aleyhinize bir sonuç çıkmasına itiraz etme ve kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme haklarına sahipsiniz.</p>
    <p>Başvurularınızı, hesabınızda kayıtlı e-posta adresinden yukarıdaki iletişim adresine gönderebilirsiniz. Başvurular en geç 30 gün içinde ücretsiz olarak sonuçlandırılır. Başvurunuzun reddedilmesi veya cevabı yetersiz bulmanız hâlinde Kişisel Verileri Koruma Kurulu'na şikâyette bulunabilirsiniz. Ayarlardaki ZIP dışa aktarımı (son 20.000 sunucu mesajınız, son 20.000 doğrudan mesajınız ve dosyalarınız) bir kolaylıktır; resmî bir başvurunun cevabı yerine geçmez.</p>
    <h2>Değişiklikler</h2>
    <p>Bu metin sürümlenir; değiştiğinde Voxpery'yi bir sonraki kullanımınızda yeni sürümü onaylamanız istenir.</p>
  </>
}

const DOCUMENTS = [
  {
    path: ROUTES.terms,
    label: 'Terms',
    lang: 'en',
    title: 'Terms of Service | Voxpery',
    description: 'Terms of Service for the official hosted Voxpery service.',
    Content: TermsOfService,
  },
  {
    path: ROUTES.privacy,
    label: 'Privacy',
    lang: 'en',
    title: 'Privacy Notice | Voxpery',
    description: 'How the official hosted Voxpery service processes personal data.',
    Content: EnglishPrivacyNotice,
  },
  {
    path: ROUTES.kvkk,
    label: 'KVKK',
    lang: 'tr',
    title: 'KVKK Aydınlatma Metni | Voxpery',
    description: 'Voxpery barındırılan hizmeti için KVKK aydınlatma metni.',
    Content: KvkkNotice,
  },
] as const

export default function LegalPage() {
  const { pathname } = useLocation()
  const active = DOCUMENTS.find(doc => doc.path === pathname) ?? DOCUMENTS[1]
  usePublicPageMetadata(active.path, active.title, active.description)
  return <main
    className="legal-page"
    tabIndex={0}
    aria-label="Hosted service legal information"
  >
    <header className="legal-page-nav">
      <Link to="/" className="legal-page-home">Voxpery</Link>
      <nav className="legal-page-tabs" aria-label="Legal documents">
        {DOCUMENTS.map(doc => (
          <Link
            key={doc.path}
            to={doc.path}
            aria-current={doc.path === active.path ? 'page' : undefined}
          >{doc.label}</Link>
        ))}
      </nav>
    </header>
    <article className="legal-document" lang={active.lang}><active.Content /></article>
  </main>
}
