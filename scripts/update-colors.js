const fs = require('fs');
const path = require('path');

const pagePath = path.join(__dirname, '../app/employees/page.js');
let content = fs.readFileSync(pagePath, 'utf8');

const replacements = {
  '"#011d35"': '"var(--color-on-background)"',
  '"#737685"': '"var(--color-outline)"',
  '"#dbe9ff"': '"var(--color-surface-container-high)"',
  '"#003d9b"': '"var(--color-primary)"',
  '"#eef4ff"': '"var(--color-surface-variant)"',
  '"#c3c6d6"': '"var(--color-outline-variant)"',
  '"#e4efff"': '"var(--color-surface-container-highest)"',
  '"#ba1a1a"': '"var(--color-error)"',
  '"#ffdad6"': '"var(--color-error-container)"',
  '"#217346"': '"var(--color-primary-container)"', // Excel button
  '"#f8f9ff"': '"var(--color-background)"',
  '"#fff"': '"var(--color-surface)"',
  '"rgba(0,61,155,0.3)"': '"rgba(5,150,105,0.3)"', // primary color shadows
  '"rgba(0,61,155,0.08)"': '"rgba(5,150,105,0.08)"',
  '"rgba(0,61,155,0.2)"': '"rgba(5,150,105,0.2)"',
  '"rgba(0,61,155,0.06)"': '"rgba(5,150,105,0.06)"',
  '"rgba(186,26,26,0.08)"': '"rgba(239,68,68,0.08)"',
  '"rgba(186,26,26,0.2)"': '"rgba(239,68,68,0.2)"',
  '"rgba(186,26,26,0.06)"': '"rgba(239,68,68,0.06)"',
};

for (const [oldVal, newVal] of Object.entries(replacements)) {
  content = content.split(oldVal).join(newVal);
}

fs.writeFileSync(pagePath, content);
console.log('Colors updated in app/page.js');
