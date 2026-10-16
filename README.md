# Lezmin Payroll

A small website that turns the monthly cleaners' salary Excel sheet into payslips, all printed in one go.

- **Nothing is stored.** The sheet is read inside the browser. When the page is closed, everything is gone.
- **One login:** the email and password Lea set up. The site only holds a scrambled fingerprint of them, never the password itself.
- **Hosted on Vercel:** the `public` folder is the whole website.

## Each month

1. Open the site and sign in.
2. Click **Import Excel sheet** and choose the month's salary file. Any layout works, as long as each tab with people on it has a row of headings that includes **Name**.
3. **Every tab, every person and every column is read.** Nothing is calculated. Amounts are copied exactly as they are in the sheet.
   - Every person row on every tab becomes a payslip (Office, Maintenance, Security, Cleaners, Home, Ritemart and so on).
   - When the same person appears on more than one tab (for example on *Main* and on *SALARY CALC*), their rows are joined into one payslip. Nicknames like "ANDY" or "(SIPHO)" are matched by section and row number.
   - If two tabs both have an amount for the same thing, the tab with the net pay / money transfer column wins.
   - Section headings in the sheet (OFFICE STAFF, WESSEL ROAD…) become the **Department**. Use **Show** to print one department at a time.
   - The heading decides where a value goes: earnings, deductions, days and leave, net pay, bank details, or notes. Columns without a heading are still included.
   - Columns that are completely empty, or all zero amounts, are left off. The KEY box at the bottom of a tab is ignored.
4. **The payslip follows the Lezmin format** and only shows what belongs on it:
   - Employee, Number, I.D. No., Start work date, Date of Birth, Occupation, Pay data and Tip.
   - Earnings: Basic Salary, Sunday Overtime, Overtime Pay, Extra Day and Public Holidays, with One day pay and Rate. Any other amount in the sheet, such as Performance Bonus or Commission, goes on the empty lines below.
   - Deductions: UIF, PAYE, Others Deductions, Unpaid Leave, Absent Leave and Late, with the number of days or late minutes under Rate.
   - Leave this month: days worked, then annual, sick, family responsibility, unpaid, absent and public holidays.
   - Bank details and net pay. Net pay is copied from the sheet's net pay / money transfer column.
   - One day pay comes from a day-rate column, or else from the KEY box (hours for their site x hourly rate). The Rate next to Basic Salary is "Working Days in Month" from the KEY box.
5. Tap anyone to check their payslip or fix something. Nothing is required.
6. Click **Print all payslips**, **Save all as one PDF** or **Save each person's slip (ZIP)**. Each slip prints on its own A4 page.

## Changing the login

The login fingerprint is `LOGIN_HASH` near the bottom of `public/app.js`. To change the email or password, ask Claude for a new fingerprint and replace that line.
