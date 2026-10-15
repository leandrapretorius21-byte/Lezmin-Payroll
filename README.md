# Lezmin Payroll

A small website that turns the monthly cleaners' salary Excel sheet into payslips, all printed in one go.

- **Nothing is stored.** The sheet is read inside the browser. When the page is closed, everything is gone.
- **One login:** the email and password Lea set up. The site only holds a scrambled fingerprint of them, never the password itself.
- **Hosted on Vercel:** the `public` folder is the whole website.

## Each month

1. Open the site and sign in.
2. Click **Import Excel sheet** and choose the month's salary file, for example `SEP 2026 salaries Cleaners.xlsx`. It reads:
   - **Cleaners tab:** names, site (O/X), leave days, absent days, public holidays, Sundays, overtime hours and late minutes.
   - **SALARY CALC tab:** bank, account number, branch code and start date. It also uses the UIF column (blank means no UIF) and the Money Transfer amount, to check the sums.
   - **KEY box:** hourly rate, Ormonde and Xavier hours, and working days.
   - **Title line** (`2026年09月工资(2026年10月02日发)`): the pay month and pay date.
3. Check the list:
   - **✓ matches sheet** means the payslip's net pay equals the sheet's Money Transfer amount.
   - A red **Sheet says R …** means the two differ. Tap the person to see why.
4. Fix anything by tapping a person. Fixes only last while the page is open.
5. Click **Print all payslips**, **Save all as one PDF** or **Save each person's slip (ZIP)**. Every slip prints on its own A4 page with the Lezmin banner.
6. Optionally click **Export to Excel** to keep a copy that includes any fixes. That file can be imported again later.

## Staff and settings

- **Staff tab:** add someone who isn't in the sheet yet, edit bank details, or remove someone from this month's payslips. This only affects the open page, so also update the Excel sheet for next month.
- **Settings tab:** company details on the payslip, and the pay rules. The rules are filled in from the sheet's KEY box on import.

## How the pay is worked out (same as the old Excel sheets)

| Item | Rule |
|---|---|
| Day rate | hourly rate × site hours (Ormonde 7.5 h, Xavier 7 h) |
| Basic salary | day rate × 26 |
| Sunday | 0.5 × day rate per Sunday worked |
| Overtime | hourly rate × 1.5 per hour |
| Public holiday worked / extra day | 1 × day rate each |
| Unpaid and absent days | minus 1 × day rate each |
| UIF | 1% of (earnings − unpaid/absent days), only for people with UIF on the sheet |
| Late minutes | recorded, not deducted (can be switched on in Settings) |

## Changing the login

The login fingerprint is `LOGIN_HASH` near the bottom of `public/app.js`. To change the email or password, ask Claude for a new fingerprint and replace that line.
