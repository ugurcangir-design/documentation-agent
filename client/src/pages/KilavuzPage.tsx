/**
 * Kullanım Kılavuzu — uygulama içine gömülü.
 *
 * İçerik tek kaynaktan gelir: client/public/kilavuz.html. Vite bunu dev'de
 * kök URL'den, prod build'de dist/ içinden servis eder; iframe ile
 * gösterilir (kendi <style>'ı app temasından izole kalsın diye). Böylece
 * kullanıcı güncel kodu çektiğinde kılavuzun son hâlini de görür —
 * ayrıca HTML dosyası paylaşmaya gerek kalmaz.
 */
export default function KilavuzPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-line flex-shrink-0">
        <div>
          <h1 className="text-[14px] font-semibold text-fg">Kullanım Kılavuzu</h1>
          <p className="text-[11.5px] text-fg3 mt-px">
            Kurulum, yapılandırma, kullanım ve sorun giderme — kodla birlikte güncellenir.
          </p>
        </div>
        <a
          href="/kilavuz.html"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11.5px] text-accent hover:underline flex items-center gap-1.5 flex-shrink-0"
        >
          Yeni sekmede aç ↗
        </a>
      </div>
      <iframe
        src="/kilavuz.html"
        title="Kullanım Kılavuzu"
        className="flex-1 w-full border-0 bg-white"
      />
    </div>
  );
}
