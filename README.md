[![New Relic Experimental header](https://github.com/newrelic/opensource-website/raw/master/src/images/categories/Experimental.png)](https://opensource.newrelic.com/oss-category/#new-relic-experimental)

# Drifter - New Relic Config Drift Detector
![GitHub forks](https://img.shields.io/github/forks/newrelic-experimental/nr-synthetics-config-drift-detector?style=social)
![GitHub stars](https://img.shields.io/github/stars/newrelic-experimental/nr-synthetics-config-drift-detector?style=social)
![GitHub watchers](https://img.shields.io/github/watchers/newrelic-experimental/nr-synthetics-config-drift-detector?style=social)

![GitHub all releases](https://img.shields.io/github/downloads/newrelic-experimental/nr-synthetics-config-drift-detector/total)
![GitHub release (latest by date)](https://img.shields.io/github/v/release/newrelic-experimental/nr-synthetics-config-drift-detector)
![GitHub last commit](https://img.shields.io/github/last-commit/newrelic-experimental/nr-synthetics-config-drift-detector)
![GitHub Release Date](https://img.shields.io/github/release-date/newrelic-experimental/nr-synthetics-config-drift-detector)


![GitHub issues](https://img.shields.io/github/issues/newrelic-experimental/nr-synthetics-config-drift-detector)
![GitHub issues closed](https://img.shields.io/github/issues-closed/newrelic-experimental/nr-synthetics-config-drift-detector)
![GitHub pull requests](https://img.shields.io/github/issues-pr/newrelic-experimental/nr-synthetics-config-drift-detector)
![GitHub pull requests closed](https://img.shields.io/github/issues-pr-closed/newrelic-experimental/nr-synthetics-config-drift-detector)


This New Relic synthetic script can be run regularly to watch for configuration drift with your New Relic resources. You specify a graphQL (or NRQL) query and identify the fields you care about and the script determines if the configuration has changed since the last run. If a change is detected the synthetic will assert a failure. The data is also reported as event data toe New Relic where it can be charted and alerted on.

You can use this generalised script to detect all manner of different resource configurations. Anything that can be queried in GraphQL (and as an extension NRQL) can be candidates.

Here are a few examples:

* Dashboards
* NRQL Alert conditions in a policy
* Notification channel subscriptions
* Drop rules
* New AWS instance types


## How it works
You provide a Graphql query that retrieves the data you care about. The script generates a unique hash for this and stores is in New Relic. When the script runs again later it re-runs the query and compares the new hash with the preivous. If they are different a fail is asserted.

## Setup
* Create a daily (or hourly) synthetic journey and add the `drifter.js` script to it. Configure the script with your account ID and account region. These control where the data is stored by the script.
* Create two secure credentials
* Define the configuration resources you want to analyse in the `runRules()` by calling `await detectDrift(YOUR-CONFIG)`. You can call multiple times with different configurations.
* The configuration is an **array** of config rules each with the following shape (check out the examples in the script):
```
await detectDrift([
    { 
        name: `Name of your config rule`,       // name of your config
        query :`GQL query here`,                // GQL query
        variables : {}                          // GQL variables object
        key: `YOUR-KEY`,                        // Hash key that the hash is stored against. Must be unique per config rule.
        matchFields: [                          // Defines what data in the GQL response to match on. Supports more than one.
            {
                dataObject: "reference",        // Root field that contains the data, e.g. "data.actor.entity" or "data.actor.account.nrql.results[0].instanceTypes"
                components: []                  // sub fields to consider (if empty array , which is usually the case, the entire root object defined above is used )
            }
        ]
    }
])
```

## Optional Config
* **CUSTOM_EVENT_TYPE** - This is the name of the custom event where data is stored and referenced. You can change this if you want to specify your own event type. You may wish to do this if running multiple copies of the script with overlapping configuration names.
* **LOOK_BACK** - Controls how far back in time we look for previous configuration hashes. This should be greater than the frequency of the script running. 

## Running locally
You can run the script locally to test:

First install the dependencies:
`npm install`

Then run with:
`node drifter.js`

## Alerting
You can easily alert on drift detection by adding a [synthetic failure alert](https://docs.newrelic.com/docs/synthetics/synthetic-monitoring/using-monitors/alerts-synthetic-monitoring#alerts-existing-monitor).

Alternatively you may wish to setup [NRQL based alerts](https://docs.newrelic.com/docs/alerts-applied-intelligence/new-relic-alerts/alert-conditions/create-nrql-alert-conditions) on the raw data. The data is by default stored in the `drifter_history` event type. If drift is detected for a rule then hashMatch will be false.

You can create a dashboard that shows recent detections with the follwing NRQL:
```
from drifter_history select configName, hashKey since 2 week ago where hashMatch is false limit max 
```

## Support

New Relic has open-sourced this project. This project is provided AS-IS WITHOUT WARRANTY OR DEDICATED SUPPORT. Issues and contributions should be reported to the project here on GitHub.

>We encourage you to bring your experiences and questions to the [Explorers Hub](https://discuss.newrelic.com) where our community members collaborate on solutions and new ideas.


## Contributing

We encourage your contributions to improve Drifter! Keep in mind when you submit your pull request, you'll need to sign the CLA via the click-through using CLA-Assistant. You only have to sign the CLA one time per project. If you have any questions, or to execute our corporate CLA, required if your contribution is on behalf of a company, please drop us an email at opensource@newrelic.com.

**A note about vulnerabilities**

As noted in our [security policy](../../security/policy), New Relic is committed to the privacy and security of our customers and their data. We believe that providing coordinated disclosure by security researchers and engaging with the security community are important means to achieve our security goals.

If you believe you have found a security vulnerability in this project or any of New Relic's products or websites, we welcome and greatly appreciate you reporting it to New Relic through [HackerOne](https://hackerone.com/newrelic).

## License

Drifter is licensed under the [Apache 2.0](http://apache.org/licenses/LICENSE-2.0.txt) License.

Drifter also uses source code from third-party libraries. You can find full details on which libraries are used and the terms under which they are licensed in the third-party notices document.]
