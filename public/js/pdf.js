// Builds the customer account statement as a real PDF (A4) using the vendored
// jsPDF + AutoTable libraries loaded in index.html.
//
// The standard PDF fonts have no ₹ sign or Unicode minus, so amounts are shown
// as plain numbers under "(Rs.)" headings.

const num = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amt = (n) => num.format(Math.round((Number(n) || 0) * 100) / 100);
const clean = (s) => String(s ?? '').replace(/₹/g, 'Rs.').replace(/[−–—]/g, '-');

const GREEN = [15, 81, 50];

// Right-align number columns in the header and footer rows too, not just the body.
const alignRightFrom = (col) => (data) => {
  if (data.column.index >= col) data.cell.styles.halign = 'right';
};
const GREY = [95, 107, 102];

export function buildStatementPdf({ settings, customer, termsLabel, sum, rows, months = [], asOf, fmtDate, typeLabel, details, monthName }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;
  let y = 16;

  // Header: pump on the left, statement title on the right
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...GREEN);
  doc.text(clean(settings.pumpName || 'Petrol Pump'), margin, y);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GREY);
  const contact = [settings.address, settings.phone && `Phone: ${settings.phone}`].filter(Boolean).map(clean).join('  |  ');
  if (contact) doc.text(contact, margin, y + 5);

  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(0);
  doc.text('ACCOUNT STATEMENT', pageW - margin, y, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GREY);
  doc.text(`As of ${fmtDate(asOf)}`, pageW - margin, y + 5, { align: 'right' });

  y += 10;
  doc.setDrawColor(...GREEN).setLineWidth(0.5).line(margin, y, pageW - margin, y);

  // Customer details
  y += 6;
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(0);
  doc.text(clean(customer.name), margin, y);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(60);
  const left = [
    customer.mobile && `Mobile: ${customer.mobile}`,
    customer.vehicle && `Vehicle: ${customer.vehicle}`,
    customer.address && `Address: ${customer.address}`,
  ].filter(Boolean).map(clean);
  left.forEach((t, i) => doc.text(t, margin, y + 5 + i * 4.5));
  doc.text(clean(termsLabel), pageW - margin, y, { align: 'right' });
  if (Number(customer.creditLimit) > 0) doc.text(`Credit limit: Rs. ${amt(customer.creditLimit)}`, pageW - margin, y + 5, { align: 'right' });
  y += 6 + Math.max(1, left.length) * 4.5;

  // Headline figures
  window.autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    head: [['Principal balance (Rs.)', 'Interest due (Rs.)', 'Total outstanding (Rs.)']],
    body: [[amt(sum.principalDue), amt(sum.interestDue), amt(sum.totalDue)]],
    styles: { fontSize: 11, halign: 'center', cellPadding: 2.5 },
    headStyles: { fillColor: [227, 241, 234], textColor: GREEN, fontSize: 8.5 },
    bodyStyles: { fontStyle: 'bold' },
    columnStyles: { 2: { textColor: [180, 35, 24] } },
  });
  y = doc.lastAutoTable.finalY + 6;

  // Month-wise summary
  if (months.length) {
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(0);
    doc.text('Month-wise summary', margin, y);
    window.autoTable(doc, {
      startY: y + 2,
      margin: { left: margin, right: margin, bottom: 16 },
      theme: 'grid',
      head: [['Month', 'Opening', 'Sales (+)', 'Payments (-)', 'Closing balance', 'Interest', 'Interest due', 'Total due']],
      body: months.map((m) => [monthName(m.month), amt(m.openingBalance), amt(m.sales), amt(m.payments), amt(m.closingBalance), amt(m.interest), amt(m.interestDue), amt(m.totalDue)]),
      foot: [['Total', '', amt(sum.totalUdhar), amt(sum.totalJama), amt(sum.principalDue), amt(sum.interestAccrued), amt(sum.interestDue), amt(sum.totalDue)]],
      showFoot: 'lastPage',
      styles: { fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: [227, 241, 234], textColor: GREEN },
      footStyles: { fillColor: [240, 243, 241], textColor: 0, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 28 } },
      didParseCell: alignRightFrom(1),
    });
    y = doc.lastAutoTable.finalY + 6;
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(0);
    doc.text('All entries', margin, y);
    y += 2;
  }

  // Ledger
  window.autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin, bottom: 16 },
    theme: 'striped',
    head: [['Date', 'Type', 'Details', 'Sale (+)', 'Payment (-)', 'Balance', 'Days', 'Interest']],
    body: rows.map((r) => {
      const isSale = r.e.type === 'udhar';
      return [
        fmtDate(r.e.date),
        typeLabel(r.e.type),
        clean(details(r.e)),
        isSale ? amt(r.e.amount) : '',
        isSale ? '' : amt(r.e.amount),
        amt(r.balance),
        r.days === '' || r.days == null ? '' : String(r.days),
        r.interest ? `${r.interest < 0 ? '-' : '+'}${amt(Math.abs(r.interest))}` : '',
      ];
    }),
    foot: [['Total', '', '', amt(sum.totalUdhar), amt(sum.totalJama), amt(sum.principalDue), '', amt(sum.interestDue)]],
    showFoot: 'lastPage',
    showHead: 'everyPage',
    didParseCell: alignRightFrom(3),
    styles: { fontSize: 8, cellPadding: 1.6, overflow: 'linebreak' },
    headStyles: { fillColor: GREEN, textColor: 255 },
    footStyles: { fillColor: [240, 243, 241], textColor: 0, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 19 },
      1: { cellWidth: 20 },
      2: { cellWidth: 'auto' },
      3: { halign: 'right', cellWidth: 22 },
      4: { halign: 'right', cellWidth: 22 },
      5: { halign: 'right', cellWidth: 24 },
      6: { halign: 'right', cellWidth: 10 },
      7: { halign: 'right', cellWidth: 20 },
    },
  });
  y = doc.lastAutoTable.finalY + 6;

  // Final calculation: principal + interest = total
  const interestLines = sum.method === 'khata'
    ? [['Interest on sales', `+ ${amt(sum.udharInterest)}`], ['Interest on payments', `- ${amt(sum.jamaInterest)}`]]
    : [['Interest charged', `+ ${amt(sum.interestAccrued)}`]];
  if (sum.interestPaid) interestLines.push(['Interest paid', `- ${amt(sum.interestPaid)}`]);
  if (sum.interestWaived) interestLines.push(['Interest waived', `- ${amt(sum.interestWaived)}`]);

  const boxW = (pageW - margin * 2 - 6) / 2;
  const box = (title, lines, total, x, startY) => {
    window.autoTable(doc, {
      startY,
      margin: { left: x, right: pageW - x - boxW },
      tableWidth: boxW,
      theme: 'plain',
      head: [[title, '(Rs.)']],
      body: lines,
      foot: [total],
      styles: { fontSize: 9, cellPadding: 1.4 },
      headStyles: { textColor: GREY, fontStyle: 'bold', fontSize: 8 },
      footStyles: { fontStyle: 'bold', textColor: 0, lineWidth: { top: 0.3 }, lineColor: 120 },
      columnStyles: { 1: { halign: 'right' } },
      didParseCell: alignRightFrom(1),
      rowPageBreak: 'avoid',
      pageBreak: 'avoid',
    });
    return doc.lastAutoTable.finalY;
  };
  if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = 16; }
  const y1 = box('PRINCIPAL', [['Total sales', `+ ${amt(sum.totalUdhar)}`], ['Total payments', `- ${amt(sum.totalJama)}`]],
    ['Principal balance', amt(sum.principalDue)], margin, y);
  const y2 = box('INTEREST', interestLines, ['Interest due', amt(sum.interestDue)], margin + boxW + 6, y);
  y = Math.max(y1, y2) + 4;

  doc.setFillColor(253, 236, 234).rect(margin, y, pageW - margin * 2, 10, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(180, 35, 24);
  doc.text(`Total outstanding = ${amt(sum.principalDue)} + ${amt(sum.interestDue)}`, margin + 3, y + 6.5);
  doc.text(`Rs. ${amt(sum.totalDue)}`, pageW - margin - 3, y + 6.5, { align: 'right' });

  // Footer on every page
  const pages = doc.internal.getNumberOfPages();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GREY);
    doc.text(`${clean(settings.pumpName || '')}  |  ${clean(customer.name)}  |  Statement as of ${fmtDate(asOf)}`, margin, pageH - 7);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 7, { align: 'right' });
  }
  return doc;
}
