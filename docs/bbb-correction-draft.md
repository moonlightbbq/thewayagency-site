# BBB profile correction draft

## Background

The current BBB profile at https://www.bbb.org/us/ky/mt-washington/profile/insurance-agency/way-insurance-llc-0402-159158212 is filed at a **Mt Washington, KY** address under the name "Way Insurance LLC".

Per Luke (2026-05-15), the agency is service-area only. There is no leased Mt Washington office. The HQ mailing is PO Box 187, Owensboro, KY 42302.

This means the BBB profile is either:
1. A stale or incorrect record, OR
2. A separate legal entity ("Way Insurance LLC") distinct from "Way Associates, Inc" (the DBA of The Way Agency)

Before submitting the correction below, Luke should confirm which entity is which.

## Submission

File at https://www.bbb.org/manage-business-listing or by emailing the BBB local office (likely BBB Louisville since Mt Washington falls under their jurisdiction).

Suggested text:

```
Subject: Profile correction request, Way Insurance LLC / The Way Agency, ID 0402-159158212

Hi BBB team,

I am writing to correct the profile at:
https://www.bbb.org/us/ky/mt-washington/profile/insurance-agency/way-insurance-llc-0402-159158212

The business operates as The Way Agency (DBA of Way Associates, Inc), an independent insurance
agency headquartered in Owensboro, KY. We are a service-area business and do not operate a
public storefront in Mt Washington.

Please update the profile as follows:

- Business name: The Way Agency (DBA of Way Associates, Inc)
- Mailing address: PO Box 187, Owensboro, KY 42302
- Service area: Daviess County, Bullitt County, and surrounding regions across Kentucky,
  Indiana, and Tennessee
- Phone: (502) 413-5335
- Email: hello@thewayagency.com
- Website: https://www.thewayagency.com

If "Way Insurance LLC" is a separate legal entity that should retain its own profile, please
let me know and I will provide documentation. Otherwise, please consolidate under
"The Way Agency (Way Associates, Inc)".

Thanks,
Sheilia Royal
The Way Agency
```

## After confirmation

Once the BBB profile is updated, verify that `data/locations.json` `agency.social.bbb` URL still resolves correctly. If the URL slug changes due to the renaming, update locations.json. Schema-generator will pick up the new URL on next build.
