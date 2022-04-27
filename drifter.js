// Important settings that need to be set for you environment
const ACCOUNT_ID = "0"  // You account ID, this is the account data from this synthetic will be stored in
const REGION = "US"           // US or EU (for the account above)

//If testign locally provide API keys here, otherwise should be specified as synthetic secure credentials DRIFTER_INSERT_KEY and DRIFTER_QUERY_KEY
const LOCAL_TESTING_INSERT_KEY = ""  ///...NRAL
const LOCAL_TESTING_QUERY_KEY  = "" //NRAK...


//Optional  settings that you can leave as is with the defualts usually
const LOOK_BACK="since 48 hours ago" //where clause for looking back over data. ensur script runs more often than this!
const CUSTOM_EVENT_TYPE=`drifter_history` //event type to record hashes


/* 
* ========================= Drifter Detection ===================
*
*/
function isObject(val) {
  if (val === null) { return false;}
  return ( (typeof val === 'function') || (typeof val === 'object') );
}

const gqlQuery = async (query, variables) => {
    const options =  {
        url: GRAPHQL_URL,
        method: 'POST',
        headers :{
          "Content-Type": "application/json",
          "API-Key": QUERY_KEY
        },
        body: JSON.stringify({ "query": query, "variables": variables })
    }
    let body = await genericServiceCall([200],options,(body)=>{ return body})
    try {
      if(isObject(body)) {
        return body
      } else {
        return JSON.parse(body)
      }  
    } catch(e) {
        console.log("Error: Response from New Relic failed to parse",e)
        assert.fail(e)
    }
}


const determineCurrentHash = async (config)=> {
    const bodyJSON =  await gqlQuery(config.query,config.variables)
    const calculateHashForData = async (data) => {
        return await crypto.createHash('sha256').update(data).digest('hex')
    }
    const composeDataMap = (data,fieldSet) => {
        if(fieldSet.components && fieldSet.components.length > 0) {
            return fieldSet.components.map((component)=>{return Object.byString(data,component)})
        } else {
            return data //return the whole object
        }
        
    }

    const dataMap=[]
    let records=0
    config.matchFields.forEach(async (fieldSet)=>{
        const data = Object.byString(bodyJSON, fieldSet.dataObject)
        if(Array.isArray(data)){
            console.log(" - Data type is array, will iterate over all items in data set")
            records=records + data.length
            data.forEach((row)=>{
                dataMap.push(composeDataMap(row,fieldSet))
            })
        } else {
            console.log(" - Data type is not an array, treating as singleton data set")
            records=records + 1
            dataMap.push(composeDataMap(data,fieldSet))
        }
    })

    //Sort the map in case the data is returned in a different order (especially true for NRQL queries)
    dataMap.sort((a,b)=>{
        const A = JSON.stringify(a)
        const B = JSON.stringify(b)
        if (A < B ) {
            return -1;
        }
        if (A > B) {
        return 1;
        }
        return 0;
    })

    const currentDataHash=await calculateHashForData(JSON.stringify(dataMap))
    console.log(` - ${records} records found, calculated hash:`, currentDataHash)
    return {hash: currentDataHash, records: records }
}

const loadPreviousHash = async (hashKey) => {
      const query = `query($accountId: Int!) {
        actor {
          account(id: $accountId) {
            nrql(query: "SELECT latest(hashValue) as hashValue, latest(records) as numRecords FROM  drifter_history WHERE hashKey='${hashKey}' ${LOOK_BACK}") {
              results
            }
          }
        }
      }`
    const vars = { "accountId": parseInt(ACCOUNT_ID)}
    let bodyJSON = await gqlQuery(query,vars)
    return bodyJSON.data.actor.account.nrql.results[0]
}

const recordLatestHash = async (metricsData) => {
    let eventsPayload=metricsData.map((metric)=>{ return {
        eventType: CUSTOM_EVENT_TYPE,
        monitorId: $env.MONITOR_ID,
        jobId: $env.JOB_ID,
        drifterVersion: DRIFTER_VERSION,
        records: metric.records,
        timestamp: Math.round(Date.now()/1000),
        hashValue: metric.hash,
        hashKey: metric.config.key+"", //make sure its a string
        hashMatch: metric.match
    }})
    await sendEventDataToNewRelic(eventsPayload)
 
}


const detectDrift = async (configArray) => {

    console.log(`\n\nDrift Detector: processing ${configArray.length} configuration records...`)
    let reportingMetrics=[]
    let mismatchRules = []
    await asyncForEach(configArray,async (config)=>{
        console.log(`\n\nProcessing config: "${config.name}" with key "${config.key}"`)
        const previousData= await loadPreviousHash(config.key)

        const previousHash= previousData.hashValue ? previousData.hashValue : ""
        const previousRecords= previousData.numRecords
        let currentData = await determineCurrentHash(config)
    
        console.log(" - Previous hash:", previousHash)
        console.log(" - Previous records:", previousRecords)
        console.log(" - Drift detected:",currentData.hash!==previousHash)
        if(!(currentData.hash===previousHash)) {
          if(previousData.hashValue === null) {
            console.log(` - !!! Mismatch detected but skipped because no previous hash available. Is this the first run?`)
          } else {
            mismatchRules.push(config.name)
          }
        }
    
        reportingMetrics.push({records:currentData.records, hash: currentData.hash, config: config, match: currentData.hash===previousHash})
    })
    if(reportingMetrics.length > 0) {
        console.log(`\n\nStoring hash data for ${reportingMetrics.length} data points in New Relic event '${CUSTOM_EVENT_TYPE}'`)
        await recordLatestHash(reportingMetrics)
    }
    
    if(mismatchRules.length > 0) {
        console.log(`!!! Drift detected for these configurations:`,mismatchRules)
        FAIL_JOURNEY=true
    }
}



/*
You shouldnt need to configure anything here!
*/
const DRIFTER_VERSION= "1.0.0"
const DEFAULT_TIMEOUT = 10000 //timeout on http requests
let RUNNING_LOCALLY=false
let FAIL_JOURNEY=false

/*
*  ========== LOCAL TESTING CONFIGURATION ==================================
* This is used if running from local laptop rather than a synthetics minion
*/
const IS_LOCAL_ENV = typeof $http === 'undefined';
if (IS_LOCAL_ENV) {  
    RUNNING_LOCALLY=true
    var $http = require("request"); 
    var $secure = {}                    
    var $env = {}
    $env.MONITOR_ID="local"
    $env.JOB_ID="0"

    //When testing ONLY set you API keys here
    $secure.DRIFTER_INSERT_KEY = LOCAL_TESTING_INSERT_KEY
    $secure.DRIFTER_QUERY_KEY = LOCAL_TESTING_QUERY_KEY

    console.log("!! Running in local mode !!\n\n\n")
} 

let assert = require('assert')
let crypto = require('crypto')

let INSERT_KEY = $secure.DRIFTER_INSERT_KEY
let QUERY_KEY = $secure.DRIFTER_QUERY_KEY

const GRAPHQL_URL= REGION=="US" ? "https://api.newrelic.com/graphql" : "https://api.eu.newrelic.com/graphql"
const EVENT_API_URL = REGION=="US" ? `https://insights-collector.newrelic.com/v1/accounts/${ACCOUNT_ID}/events` : `https://insights-collector.eu01.nr-data.net/v1/accounts/${ACCOUNT_ID}/events`

/*
*  ========== SOME HELPER FUNCTIONS ===========================
*/


/*
    Helper function to target objects properties by string
    From https://gist.github.com/avin/98fd94c07f12cefb7c6d
*/
Object.byString = function(o, s) {
    s = s.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties
    s = s.replace(/^\./, '');           // strip a leading dot
    var a = s.split('.');
    for (var i = 0, n = a.length; i < n; ++i) {
        var k = a[i];
        if (k in o) {
            o = o[k];
        } else {
            return;
        }
    }
    return o;
}

/*
* asyncForEach()
*
* A handy version of forEach that supports await.
* @param {Object[]} array     - An array of things to iterate over
* @param {function} callback  - The callback for each item
*/
async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
      await callback(array[index], index, array);
    }
  }
  

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/*
* genericServiceCall()
* Generic service call helper for commonly repeated tasks
*
* @param {number} responseCodes  - The response code (or array of codes) expected from the api call (e.g. 200 or [200,201])
* @param {Object} options       - The standard http request options object
* @param {function} success     - Call back function to run on successfule request
*/
const genericServiceCall = function(responseCodes,options,success) {
    !('timeout' in options) && (options.timeout = DEFAULT_TIMEOUT) //add a timeout if not already specified 
    let possibleResponseCodes=responseCodes
    if(typeof(responseCodes) == 'number') { //convert to array if not supplied as array
      possibleResponseCodes=[responseCodes]
    }
    return new Promise((resolve, reject) => {
        $http(options, function callback(error, response, body) {
        if(error) {
            reject(`Connection error on url '${options.url}'`)
        } else {
            if(!possibleResponseCodes.includes(response.statusCode)) {
                let errmsg=`Expected [${possibleResponseCodes}] response code but got '${response.statusCode}' from url '${options.url}'`
                reject(errmsg)
            } else {
                resolve(success(body,response,error))
            }
          }
        });
    })
  }



/*
* setAttribute()
* Sets a custom attribute on the synthetic record
*
* @param {string} key               - the key name
* @param {Strin|Object} value       - the value to set
*/
const setAttribute = function(key,value) {
    if(!RUNNING_LOCALLY) { //these only make sense when running on a minion
        $util.insights.set(key,value)
    } else {
        console.log(`Set attribute '${key}' to ${value}`)
    }
}


/*
* sendEventDataToNewRelic()
* Sends a events payload to New Relic
*
* @param {object} data               - the payload to send
*/
const sendEventDataToNewRelic = async (data) =>  {
    let request = {
        url: EVENT_API_URL,
        method: 'POST',
        headers :{
            "Api-Key": INSERT_KEY
        },
        body: JSON.stringify(data)
    }
    ///console.log(" - Sending data to NR events API...")
    return genericServiceCall([200,202],request,(body,response,error)=>{
        if(error) {
            log(`NR Post failed : ${error} `,true)
            return false
        } else {
            return true
        }
        })
}


/*
*
* *************************************************************************************************************************************************
*
*/

/*
* Example rule helper functions
* These functions compose a set of configurations to test.
*/

//EXAMPLE: Detect changes to policies subscribed to a notification channel
const drift_NotificationChannels = async () => {
    console.log("\n\n------\nNotification channel update detector")

    const accountID=ACCOUNT_ID //set the account ID to look in, this might not be the one we run the synthetic job in.
    const channelIDs = ["6198084"] // Array of notification channels we're interested in watching
    const config = channelIDs.map((channelID)=>{
        return { 
            name: `Notification channel detection, channel: ${channelID}`,
            query :`query ($accountId: Int!, $channelId: ID!){
                actor {
                  account(id: $accountId) {
                    alerts {
                      notificationChannel(id: $channelId) {
                        ... on AlertsSlackNotificationChannel {
                          id
                          name
                          config {
                            teamChannel
                            url
                          }
                          associatedPolicies {
                            policies {
                              id
                            }
                            totalCount
                          }
                          type
                        }
                      }
                    }
                  }
                }
              }`,
            variables : {
                accountId: accountID,
               channelId:  channelID
              },
            key: `NOTIFYCHAN-${channelID}`,
            matchFields: [
                {
                    dataObject: "data.actor.account.alerts.notificationChannel",
                    components: []
                }
            ]

        }
    })
    await detectDrift(config)
}

//EXAMPLE: looks for dashboard changes. We only test the updatedAt timestamps in this example.
const drift_Dashboard = async () => {
    console.log("\n\n------\nDashboard update detector")

    const dashboardGUIDs = ["MjQ2MDk4N3xWSVp8REFTSEJPQVJEfGRhOjExMjA5Njk"] // an array of dashboard GUID's we want to watch
    const config = dashboardGUIDs.map((GUID)=>{
        return { 
            name: `Dashboard detection ${GUID}`,
            query :`query ($guid: EntityGuid!){
                actor {
                  entity(guid: $guid) {
                    ... on DashboardEntity {
                      name
                      guid
                      pages {
                        updatedAt
                      }
                      updatedAt
                    }
                  }
                }
              }
              `,
            variables : {
                guid: GUID
              },
            key: `DASH1-${GUID}`,
            matchFields: [
                {
                    dataObject: "data.actor.entity",
                    components: ["name", "updatedAt"]
                },
                {
                    dataObject: "data.actor.entity.pages",
                    components: [ "updatedAt"]
                }

            ]

        }
    })
    await detectDrift(config)
}

//EXAMPLE: This example looks for dashboard changes for specified dashboards. Any change to the dashboard responses object causes a match. Bit simpler than previous.
const drift_Dashboard2 = async () => {
    console.log("\n\n------\nDashboard update detector")
    
    const dashboardGUIDs = ["MjQ2MDk4N3xWSVp8REFTSEJPQVJEfGRhOjExMjA5Njk"]
    const config = dashboardGUIDs.map((GUID)=>{
        return { 
            name: `Dashboard detection ${GUID}`,
            query :`query ($guid: EntityGuid!){
                actor {
                  entity(guid: $guid) {
                    ... on DashboardEntity {
                      name
                      guid
                      pages {
                        updatedAt
                      }
                      updatedAt
                    }
                  }
                }
              }
              `,
            variables : {
                guid: GUID
              },
            key: `DASH2-${GUID}`,
            matchFields: [
                {
                    dataObject: "data.actor.entity",
                    components: []
                }
            ]

        }
    })
    await detectDrift(config)
}

const drift_NRQLPolicyConditions = async () => {
    // This example shows how you might target an alert policies NRQL conditions
    console.log("\n\n------\nPolicy NRQL Conditions detector")

    const accountID=ACCOUNT_ID
    const policyIDs = [2417844,2418142] // array of policy ID's we're interested in
    const config = policyIDs.map((policyID)=>{
        return { 
            name: `Policy drift detection ${policyID}`,
            query :`query ($accountId: Int!, $policyId: ID!) {
                actor {
                  account(id: $accountId) {
                    alerts {
                      nrqlConditionsSearch(searchCriteria: {policyId: $policyId}) {
                        nrqlConditions {
                          id
                          name
                          ... on AlertsNrqlCondition {
                            id
                            name
                            nrql {
                              query
                            }
                            description
                            enabled
                            expiration {
                              closeViolationsOnExpiration
                              expirationDuration
                              openViolationOnExpiration
                            }
                            policyId
                            signal {
                              aggregationDelay
                              aggregationMethod
                              aggregationWindow
                              aggregationTimer
                              fillOption
                              slideBy
                              fillValue
                            }
                            runbookUrl
                            terms {
                              operator
                              priority
                              threshold
                              thresholdDuration
                              thresholdOccurrences
                            }
                            type
                            violationTimeLimitSeconds
                          }
                          ... on AlertsNrqlBaselineCondition {
                            id
                            name
                            nrql {
                              query
                            }
                            baselineDirection
                            description
                            enabled
                            expiration {
                              closeViolationsOnExpiration
                              expirationDuration
                              openViolationOnExpiration
                            }
                            policyId
                            runbookUrl
                            signal {
                              aggregationDelay
                              aggregationMethod
                              aggregationTimer
                              aggregationWindow
                              fillOption
                              fillValue
                              slideBy
                            }
                            terms {
                              operator
                              priority
                              threshold
                              thresholdDuration
                              thresholdOccurrences
                            }
                            type
                            violationTimeLimitSeconds
                          }
                        }
                        totalCount
                      }
                    }
                  }
                }
              }`,
            variables : {
                "accountId": accountID,
                "policyId": policyID
              },
            key: `POLICY-${policyID}`,
            matchFields: [
                {
                    dataObject: "data.actor.account.alerts.nrqlConditionsSearch.nrqlConditions",
                    components: []
                }
            ]
        }
    })
    await detectDrift(config)
}

//EXAMPLE: Detects changes to drop rules from multiple accounts
const drift_DropRules = async () => {
    console.log("\n\n------\nDrop rules detector")

    // Grab all the accounts we can access and generate config for each account
    let accounts= await gqlQuery(`{
        actor {
            accounts {
            id
            name
            }
        }
        }`,{})

    //generate config for each account 
    const config = accounts.data.actor.accounts.map((account)=>{
        return { 
            name: `Drop Rules Account ${account.name}`,
            query : `query ($accountId: Int!) {
            actor {
                account(id: $accountId) {
                nrqlDropRules {
                    list {
                    rules {
                        id
                        nrql
                        action
                        accountId
                        source
                    }
                    }
                }
                }
            }
            }`,
            variables : { "accountId": parseInt(account.id)},
            key: `DROPRULES-${account.id}`,
            matchFields: [{
                dataObject: "data.actor.account.nrqlDropRules.list.rules",
                components: [
                    "accountId",
                    "action",
                    "id",
                    "nrql",
                    "source"
                ]
            }]
           
        }
    })
    await detectDrift(config)
}


//EXAMPLE: Detects changes instance types in use
const drift_NRQLExample1 = async () => {
    console.log("\n\n------\nNRQL instance type detector")

    const accountID=ACCOUNT_ID

    const config = [{
        name: `Instance Types (NRQL)`,
        query : `query ($accountId: Int!) {
            actor {
                account(id: $accountId) {
                    nrql(query: "FROM SystemSample select uniques(instanceType) as 'instanceTypes' where awsRegion is not null limit max since 30 minutes ago") {
                        results
                    }
                }
            } 
        }`,
        variables : { "accountId": parseInt(accountID)},
        key: `NRQL1`,
        matchFields: [{
            dataObject: "data.actor.account.nrql.results[0].instanceTypes",
            components: []
        }] 
    }]
    await detectDrift(config)
}

/*
*
* *******************************************************************************************************************************
*
*/


async function runRules()  {
    // Add your configuration here.


    //here are some examples wrapped in helper functions ----------------------------------
    await drift_NotificationChannels()
    await drift_Dashboard()
    await drift_Dashboard2()
    await drift_NRQLPolicyConditions()
    await drift_DropRules() 
    await drift_NRQLExample1()


    //an inline example (no helper function)
    await detectDrift([{ 
        name: `Inline Dashboard example`,                            //name of your config
        query :`query ($guid: EntityGuid!){                         
            actor {
              entity(guid: $guid) {
                ... on DashboardEntity {
                  name
                  guid
                  pages {
                    updatedAt
                  }
                  updatedAt
                }
              }
            }
          }
          `,                                                        //GQL query
        variables : {                                               //GQL variables
            guid: "MjQ2MDk4N3xWSVp8REFTSEJPQVJEfGRhOjExMjA5Njk"
          },
        key: `INLINE-EXAMPLE`,                                      //Hash key that the has is stored against
        matchFields: [                                              //Define which field(s) in the GQL response to 
            {
                dataObject: "data.actor.entity",                    // Root field that contains the data
                components: []                                      // sub components to consider (if empty array the entire root object defined above is used )
            }
        ]
    }])

    //end examples ---------------------------


    return !FAIL_JOURNEY
}

try {
  runRules()
    .then((success)=>{   
        console.log("\n\n----------------------------")
        setAttribute("completedScript",true)
        if(success === true ) {
            console.log("Completed successfully with no config drift detected")
            setAttribute("driftFound",false)
        } else {
            console.log("Completed successfully but drift was detected.")
            setAttribute("driftFound",true)
            assert.fail("Some resources appear to have suffered config drift. Check the log.")
        }
    })
} catch(e) {
    console.log("Unexpected errors: ",e)
}