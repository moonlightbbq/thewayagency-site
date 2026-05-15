# Wikidata item draft, The Way Agency

This is the proposed Wikidata item for The Way Agency. Once created, paste the Q-ID into `data/locations.json` `agency.social.wikidata` and move it out of `pending_sameAs`. The schema injectors will then emit it as a `sameAs` URL.

Create at https://www.wikidata.org/wiki/Special:NewItem while logged into a Wikidata account.

## Labels

- English label: The Way Agency
- English description: Independent insurance agency in Owensboro, Kentucky, United States, licensed in Kentucky, Indiana, and Tennessee

## Aliases (English)

- Way Agency
- Way Associates, Inc

## Statements

| Property | Value | Source |
|---|---|---|
| instance of (P31) | insurance broker (Q806798) or insurance agency | self-description |
| country (P17) | United States of America (Q30) | self-description |
| headquarters location (P159) | Owensboro (Q484908) | data/locations.json |
| inception (P571) | 1998 | data/locations.json `agency.founded` |
| area served (P2541) | Kentucky (Q1603), Indiana (Q1415), Tennessee (Q1509) | data/locations.json `service_areas` |
| official website (P856) | https://www.thewayagency.com | site root |
| legal form (P1454) | corporation (or LLC if Way Associates, Inc is a different entity) | data/locations.json `agency.legal_name` |
| owned by (P127) | (skip unless you want it public) | n/a |
| official name (P1448) | Way Associates, Inc | data/locations.json |
| Facebook ID (P2013) | TheWayAgency | data/locations.json |
| Instagram username (P2003) | thewayagencyins | data/locations.json |
| LinkedIn personal profile ID (P6634) or LinkedIn company ID | the-way-agency-insurance | data/locations.json |

## Sitelinks

Skip unless an English Wikipedia article exists. The Way Agency does not currently have one and creating one would require notability sources (Messenger-Inquirer or Owensboro Times coverage).

## After creation

1. Note the Q-ID (e.g., Q123456789).
2. In `data/locations.json`, change `pending_sameAs.wikidata` to a key under `agency.social`:
   ```json
   "wikidata": "https://www.wikidata.org/wiki/Q123456789"
   ```
3. Commit and push. The schema-generator emits `Organization.sameAs` from `Object.values(agency.social)`, so the Q-ID URL flows automatically.

## Why this matters

AI engines (ChatGPT, Claude, Perplexity, Gemini, Google AI Overviews) heavily weight Wikidata for entity grounding. A Q-ID disambiguates "The Way Agency" from any other "Way" or "The Way" entity in their training data and gives them a canonical URL set to cite from.
