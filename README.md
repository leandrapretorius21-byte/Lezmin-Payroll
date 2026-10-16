# Lezmin Payroll

A small website that turns the monthly cleaners' salary Excel sheet into payslips, all printed in one go.

- **Nothing is stored.** The sheet is read inside the browser. When the page is closed, everything is gone.
- **One login:** the email and password Lea set up. The site only holds a scrambled fingerprint of them, never the password itself.
- **Hosted on Vercel:** the `public` folder is the whole website.

## Each month

1. Open the site and sign in.
2. Click **Import Excel sheet** and choose the month's salary file. Any layout works, as long as one row of headings includes **Name**.
3. Every column is copied onto the payslips exactly as it is. **Nothing is calculated.** The heading decides where a value goes:
   - **Details:** name, employee number, site, ID, start date, occupation.
   - **Earnings:** basic salary, overtime, bonus, allowance and other amounts.
   - **Deductions:** UIF, PAYE, loan, advance, unpaid leave amount, late deduction.
   - **Totals:** a "Total" or "Gross" column, and "Total deductions".
   - **Net pay:** "Net pay", "Nett" or "Money transfer".
   - **Days, leave and hours:** days worked, leave days, Sundays, hours, late minutes.
   - **Paid into:** bank, account, branch code.
   - Columns that are completely empty, or all zero amounts, are left off.
4. Tap anyone to check their payslip or fix something. Nothing is required.
5. Click **Print all payslips**, **Save all as one PDF** or **Save each person's slip (ZIP)**. Each slip prints on its own A4 page.

## Changing the login

The login fingerprint is `LOGIN_HASH` near the bottom of `public/app.js`. To change the email or password, ask Claude for a new fingerprint and replace that line.
