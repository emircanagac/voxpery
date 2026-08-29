import { Link, useLocation } from 'react-router'

const UPDATED_AT = '23 August 2026'

function EnglishPrivacyNotice() {
  return <>
    <h1>Privacy Notice</h1>
    <p><strong>Version:</strong> 2026-08-23 · <strong>Last updated:</strong> {UPDATED_AT}</p>
    <p>This notice applies only to the official hosted service at voxpery.com. Self-hosted Voxpery operators are separate controllers and must publish their own notice.</p>
    <h2>Controller and contact</h2>
    <p>The hosted service is operated by Emircan Agac as an individual open-source project operator in Türkiye. Privacy requests can be sent to <a href="mailto:voxpery@gmail.com">voxpery@gmail.com</a>.</p>
    <h2>Data we process</h2>
    <ul>
      <li>Account and profile data: username, email, password hash, avatar, optional about-me text, status, account preferences and linked Google identifier.</li>
      <li>Community data: servers, memberships, roles, friends, moderation records, messages, direct messages, reactions and uploaded files.</li>
      <li>Technical and security data: short-lived authentication/session records, rate-limit keys, security logs and privacy-safe reliability events when enabled.</li>
      <li>Voice and video media is routed through the self-hosted LiveKit service. Voxpery does not intentionally record calls, cameras or screen shares.</li>
    </ul>
    <h2>Important message-content notice</h2>
    <p>Messages, direct messages and attachments are not end-to-end encrypted today. The hosted server stores and can technically access this content for delivery, account export, abuse handling, security and lawful requests. Do not use Voxpery to send secrets that require E2E protection.</p>
    <h2>Purposes and legal bases</h2>
    <p>Data is used to create and secure accounts, provide communication features, prevent abuse, operate and troubleshoot the service, comply with law and establish or defend legal claims. Depending on the context, processing relies on performance of the Terms, legitimate interests in operating a safe service, legal obligations, or consent where the law specifically requires it.</p>
    <h2>Processors and international transfers</h2>
    <p>The service uses hosting in Germany, Cloudflare for edge/security services, Google for optional sign-in and email delivery, and GIPHY only when GIF search is enabled. LiveKit, PostgreSQL and Redis are operated with the hosted stack. Providers may process limited data needed for their service. Cross-border transfers are reviewed under applicable GDPR and KVKK safeguards; provider DPAs and transfer instruments remain an operator compliance requirement.</p>
    <h2>Retention</h2>
    <p>Account and user content is kept while the account or content remains active, then deleted or anonymised through the applicable deletion workflow unless law or dispute handling requires a limited hold. Privacy-safe observability logs are retained for no more than 14 days. Backups expire under the operator backup cycle and deleted data may remain until that cycle completes.</p>
    <h2>Your rights</h2>
    <p>You may request access, correction, deletion, restriction, objection or portability where applicable, and complain to a competent authority. The in-app ZIP is a bounded convenience export, not a complete legal access response. Send formal requests to the contact above; additional identity verification may be required.</p>
    <h2>Changes and incidents</h2>
    <p>Material changes are versioned and announced in the hosted service or repository. Suspected personal-data incidents can be reported to the same contact.</p>
  </>
}

function TermsOfService() {
  return <>
    <h1>Terms of Service</h1>
    <p><strong>Version:</strong> 2026-08-23 · <strong>Last updated:</strong> {UPDATED_AT}</p>
    <p>These Terms govern the official hosted Voxpery service. The source code remains licensed separately under AGPL-3.0-only.</p>
    <h2>Eligibility and accounts</h2>
    <p>You must be legally able to accept these Terms and provide accurate account information. You are responsible for your credentials and activity. Do not use the service if local law requires parental or guardian approval that you do not have.</p>
    <h2>Acceptable use</h2>
    <p>Do not abuse, harass, threaten, exploit minors, distribute malware, evade access controls, infringe rights, overload the service, automate spam, or use Voxpery for unlawful content or activity. Reasonable rate and storage limits apply.</p>
    <h2>Your content</h2>
    <p>You retain rights in your content. You grant the hosted operator the limited permission needed to store, process, transmit, moderate and back up that content to operate and secure the service. You are responsible for having the right to share it.</p>
    <h2>Moderation and availability</h2>
    <p>Content or accounts may be restricted when necessary for safety, law, security or service integrity. Voxpery is an early-stage volunteer-operated service provided without guaranteed uptime. Features may change, and the service may be suspended with reasonable notice where practical.</p>
    <h2>Privacy, termination and liability</h2>
    <p>The Privacy Notice explains data processing. You may delete your account through Settings. To the maximum extent permitted by law, the service is provided as-is without warranties and the operator is not liable for indirect or consequential losses. Mandatory consumer rights remain unaffected.</p>
    <h2>Contact</h2>
    <p>Questions about these Terms: <a href="mailto:voxpery@gmail.com">voxpery@gmail.com</a>.</p>
  </>
}

function KvkkNotice() {
  return <>
    <h1>KVKK Aydınlatma Metni</h1>
    <p><strong>Sürüm:</strong> 2026-08-23 · <strong>Son güncelleme:</strong> 23 Ağustos 2026</p>
    <p>Bu metin yalnız voxpery.com adresindeki resmî barındırılan hizmet için geçerlidir. Self-host kurulumların işletmecileri kendi veri işleme faaliyetlerinden sorumludur.</p>
    <h2>Veri sorumlusu ve iletişim</h2>
    <p>Barındırılan hizmetin veri sorumlusu, Türkiye'de bireysel açık kaynak proje işletmecisi olarak Emircan Agac'tır. İlgili kişi başvuruları <a href="mailto:voxpery@gmail.com">voxpery@gmail.com</a> adresine gönderilebilir.</p>
    <h2>İşlenen kişisel veriler</h2>
    <p>Kimlik ve iletişim bilgileri, hesap/profil tercihleri, sunucu ve arkadaşlık ilişkileri, mesajlar ve doğrudan mesajlar, yüklenen dosyalar, moderasyon kayıtları, oturum/güvenlik kayıtları ve hizmetin çalışması için gerekli sınırlı teknik veriler işlenir. Ses, kamera ve ekran paylaşımı self-host LiveKit üzerinden anlık iletilir; görüşmeler kasıtlı olarak kaydedilmez.</p>
    <h2>İşleme amaçları ve hukuki sebepler</h2>
    <p>Veriler; hesabın kurulması, iletişim özelliklerinin sunulması, güvenlik ve kötüye kullanımın önlenmesi, hata giderme, hukuki yükümlülükler ile bir hakkın tesisi/kullanılması/korunması amaçlarıyla KVKK'nın 5. maddesindeki sözleşmenin kurulması veya ifası, hukuki yükümlülük, meşru menfaat ve gerektiğinde açık rıza şartlarına dayanılarak işlenir.</p>
    <h2>Aktarımlar</h2>
    <p>Hizmet Almanya'da barındırılır. Güvenlik/edge hizmetleri için Cloudflare, isteğe bağlı giriş ve e-posta için Google, GIF araması etkinse GIPHY sınırlı veri işleyebilir. Yurt dışı aktarımlar KVKK m.9 kapsamındaki uygun güvenceler ve sağlayıcı sözleşmeleriyle ayrıca doğrulanmalıdır.</p>
    <h2>Saklama, mesaj gizliliği ve haklar</h2>
    <p>Mesajlar, DM'ler ve dosyalar bugün uçtan uca şifreli değildir; hizmet sunucusu bunları teknik olarak okuyabilir. Veriler amaç için gerekli süre boyunca, silme talebi/hesap silme ve yasal saklama ihtiyaçları dikkate alınarak tutulur. KVKK m.11 kapsamındaki haklarınız için yukarıdaki adrese başvurabilirsiniz. Uygulamadaki ZIP dışa aktarımı sınırlı bir kolaylık paketidir ve tam ilgili kişi başvurusu cevabı değildir.</p>
  </>
}

export default function LegalPage() {
  const { pathname } = useLocation()
  const content = pathname === '/terms'
    ? <TermsOfService />
    : pathname === '/kvkk'
      ? <KvkkNotice />
      : <EnglishPrivacyNotice />
  return <main
    className="legal-page"
    tabIndex={0}
    aria-label="Hosted service legal information"
  >
    <div className="legal-page-nav"><Link to="/">Voxpery</Link><span>Hosted service legal information</span></div>
    <article className="legal-document">{content}</article>
  </main>
}
