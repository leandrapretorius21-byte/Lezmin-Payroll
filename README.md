# Lezmin Payroll — setup guide

A small private website for the Lezmin 2358 CC cleaners: staff list, monthly capture, and every payslip printed or saved in one click.

- **Website:** Vercel (the `public` folder)
- **Data and logins:** Supabase
- **Only people you add** can sign in and see anything. Signed-out visitors see a login box and nothing else.

Do the steps in order. It takes about 30 minutes.

---

## Part 1 — Supabase (the database)

**1. Make a new project**
1. Go to supabase.com → **New project**.
2. Name it `lezmin-payroll` and pick the region closest to Johannesburg that's on offer.
3. Save the database password somewhere safe (you won't need it day to day).

**2. Create the tables and security**
1. Left menu → **SQL Editor** → **New query**.
2. Open `setup/1-schema.sql`, copy everything, paste it in and press **Run**. You should see "Success. No rows returned".

**3. Load your 25 staff and September**
1. **New query** again.
2. Paste in everything from `setup/2-your-staff.sql` and press **Run**.
3. Check: left menu → **Table Editor** → `staff` should show 25 rows.
4. **Delete `2-your-staff.sql` from your computer now.** It has everyone's bank account numbers in it and is no longer needed.

**4. Stop strangers from creating logins**
1. Left menu → **Authentication** → **Sign In / Providers** (on some layouts: **Providers** or **Settings**).
2. Turn **off** "Allow new users to sign up". Save.

**5. Create the two logins**
1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter his email and a password. Tick **Auto Confirm User**. Create.
3. Do the same for your own email.

**6. Give those two emails access**
1. **SQL Editor** → **New query**. Paste this, with the real emails, and press **Run**:

```sql
insert into public.app_users (email, role) values ('YOUR-EMAIL', 'admin') on conflict (email) do update set role = excluded.role;
insert into public.app_users (email, role) values ('HIS-EMAIL', 'user') on conflict (email) do update set role = excluded.role;
```

- `admin` also sees the **Settings** page (hourly rate, UIF %, company details).
- `user` can do everything else but cannot change the pay rules.

**7. Copy the two keys**
1. **Project Settings** → **API** (or **Data API**).
2. Copy the **Project URL** and the **anon public** key.
3. Open `public/config.js` and paste them between the quotes.

---

## Part 2 — Vercel (the website)

**8. Put the folder on GitHub**
1. Make a **private** repository called `lezmin-payroll` and push this folder.
2. `setup/2-your-staff.sql` is listed in `.gitignore`, so it won't upload even if you forgot to delete it.

**9. Deploy**
1. vercel.com → **Add New** → **Project** → import `lezmin-payroll`.
2. Framework preset: **Other**. Leave the build settings empty, because `vercel.json` already tells Vercel to serve the `public` folder.
3. Before pressing Deploy, open **Environment Variables** and add:
   - `SUPABASE_URL` = the Project URL from step 7
   - `SUPABASE_ANON_KEY` = the anon key from step 7

   These feed a small daily job that stops the free Supabase project from going to sleep between paydays.
4. Press **Deploy**.

**10. Check it**
1. Open the site and sign in with your email.
2. It should open on **September 2026**, with **Total to transfer R 141 936.37**. That's your salary sheet's total once each person's pay is rounded to the cent, which is what the bank actually pays out.
3. Press **Save all as one PDF** and look at a couple of slips. Each person is on their own A4 page, so there's nothing to cut.

**11. Hand it over**
1. Send him the website link and his password.
2. On his computer, open the link, sign in and bookmark it. He stays signed in.

---

## His monthly routine

1. Open the bookmark. It shows the month he's paying.
2. Tap a person and type only what changed:
   - unpaid days, absent days and other leave
   - Sundays, public holidays worked and overtime

   Anyone he doesn't tap gets a normal full month. Everything saves by itself and stays saved, even if he closes the browser, until step 5.
3. Check **Total to transfer**.
4. Press **Print all payslips** and **Export to Excel**.
5. Press **Start next month**. It offers the Excel export again, then clears all the monthly figures and moves on to the next month. Staff, bank details and pay rates are kept.

### Other buttons
- **Save all as one PDF:** every payslip in one file, one person per page.
- **Save each person's slip (ZIP):** one PDF per person, named with their number and name. Handy for WhatsApp.
- **Export to Excel:** a first tab with everyone's figures, bank details and net pay (for the bank transfers), then one tab per person with their payslip.
- **Month box:** change which month is being paid, if it ever shows the wrong one.

### New or leaving staff
- **New staff:** Staff → **Add new staff member**. It asks for:
  - name and ID number
  - start date and site
  - bank details
  - whether UIF applies

  It suggests the next employee number.
- **Someone leaves:** open them → **Mark as left** → last working day. They get a final payslip for that month, then drop off.
- **Someone joins or leaves mid-month:** put the days they weren't employed under **Not employed yet / any more**. Those days come off their pay.

---

## How the pay is worked out (matches the old Excel sheets)

| Item | Rule |
|---|---|
| Day rate | hourly rate × site hours (Ormonde 7.5 h, Xavier 7 h at R30.23) |
| Basic salary | day rate × 26 |
| Sunday | 0.5 × day rate per Sunday worked |
| Overtime | hourly rate × 1.5 per hour |
| Public holiday worked / extra day | 1 × day rate each |
| Unpaid, absent, not-employed days | minus 1 × day rate each |
| UIF | 1% of (earnings − unpaid/absent days), only for people marked "Deduct UIF" |
| Late minutes | recorded, not deducted (switch on in Settings if wanted) |

All of these numbers can be changed on the **Settings** page, which only you (admin) can see.

## Adding or removing access later

- **Add a login:**
  1. Supabase → Authentication → Users → Add user.
  2. Run the `insert into public.app_users …` line from step 6 with their email.
- **Remove a login:** delete the user in Supabase → Authentication → Users, and run:
  `delete from public.app_users where email = 'their@email';`
- **Reset his password:** Authentication → Users → the three dots next to his name.
