/**
 * Universal PDF export utility.
 * Uses the browser's native print-to-PDF capability for clean output.
 */
export function exportPageAsPDF(title: string) {
  // Create a temporary style to hide non-printable elements and format for PDF
  const style = document.createElement('style');
  style.id = 'pdf-export-style';
  style.textContent = `
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      nav, [data-no-print], .print\\:hidden, button, [role="navigation"] { display: none !important; }
      .print\\:block { display: block !important; }
      .print\\:px-0 { padding-left: 0 !important; padding-right: 0 !important; }
      .print\\:py-0 { padding-top: 0 !important; padding-bottom: 0 !important; }
      .print\\:max-w-none { max-width: none !important; }
      .print\\:mb-4 { margin-bottom: 1rem !important; }
    }
  `;
  document.head.appendChild(style);

  // Add header with title and date
  const header = document.createElement('div');
  header.id = 'pdf-export-header';
  header.className = 'print:block hidden';
  header.style.cssText = 'display:none;';
  header.innerHTML = `
    <div style="padding:16px 0;border-bottom:2px solid #333;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:18px;font-weight:bold;">${title}</div>
      <div style="font-size:11px;color:#666;">Exportado em ${new Date().toLocaleString('pt-BR')}</div>
    </div>
  `;

  // Insert header at start of main content
  const main = document.querySelector('main') || document.querySelector('[class*="max-w"]') || document.body;
  main.insertBefore(header, main.firstChild);

  // Show header for print
  const mediaQuery = window.matchMedia('print');
  header.style.display = 'none';

  const showHeader = () => { header.style.display = 'block'; };
  const cleanup = () => {
    header.remove();
    style.remove();
  };

  // Use beforeprint/afterprint events
  window.addEventListener('beforeprint', showHeader, { once: true });
  window.addEventListener('afterprint', cleanup, { once: true });

  // Fallback cleanup after 5 seconds
  setTimeout(cleanup, 5000);

  window.print();
}
