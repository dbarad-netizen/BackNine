# Strategy D, Incorporated — public website

A static, single-page marketing site for Strategy D. Built to satisfy
Apple's Developer Program enrollment requirement for a publicly-
verifiable business web presence tied to the legal entity.

Zero dependencies. Pure HTML + CSS. Deploys anywhere static assets are
served (Vercel, Netlify, GitHub Pages, S3, etc.).

## Files

| File | Purpose |
|------|---------|
| `index.html` | The whole site — hero, thesis, portfolio, approach, contact, footer |
| `robots.txt` | Allow all crawlers — Apple's reviewer needs to reach it |
| `sitemap.xml` | Single URL sitemap for good SEO hygiene |
| `vercel.json` | Cache + security headers for Vercel deployment |

## Deploy to Vercel (recommended — matches BackNine stack)

```bash
cd ~/Documents/BackNine/strategyd-site
npx vercel --prod
```

First run will prompt you to:
1. Log in to Vercel (choose your existing account)
2. Link to a new or existing project → pick **Create new project**
3. Name it `strategyd-site` or `strategy-d`
4. Framework preset → **Other** (it's just static HTML)
5. Root directory → **.**
6. Build command → leave empty
7. Output directory → **.**

After deploy, Vercel will give you a `*.vercel.app` URL. Open it and
verify the site renders correctly.

## Point strategyd.com at the deployment

1. In the Vercel dashboard → your new project → **Domains** → **Add**
2. Enter `strategyd.com` and `www.strategyd.com`
3. Vercel will show you the DNS records to add — usually:
   - `A` record on the apex → `76.76.21.21`
   - `CNAME` on `www` → `cname.vercel-dns.com`
4. In your domain registrar's control panel, add those records
5. Wait 5-30 min for propagation and SSL provisioning
6. Confirm `https://www.strategyd.com` loads with a valid cert

## Verify before submitting to Apple

Apple's Developer Program reviewer will:
- Google "Strategy D" and expect to find this site
- Check that the site clearly identifies Strategy D, Incorporated as a
  legal business (address, D-U-N-S, contact email)
- Verify the site has real content, not a "coming soon" placeholder
- Check that the domain WHOIS reasonably matches the legal entity

Pre-flight checklist:
- [ ] `www.strategyd.com` loads over HTTPS with valid cert
- [ ] Homepage renders on mobile Safari without layout breaks
- [ ] Address block matches the D-U-N-S filing address exactly
- [ ] The `mailto:david@strategyd.com` link works (create the mailbox
      before submitting — Apple sometimes emails to verify)
- [ ] Site shows up on a Google search for "Strategy D Los Angeles"
      within 48h of deploy (submit to Google Search Console to speed
      this up)

## Content edits

All copy lives inline in `index.html`. Search for the section you want
to change (e.g. `<!-- ── Thesis ── -->`) and edit. No build step.

## LAST REVIEWED: 2026-07-27
