/**
 * Provider boundary for Gmail today and Microsoft Graph in a later phase.
 * @typedef {{id:string,threadId:string,headers:Record<string,string>,body:string,snippet:string}} MailMessage
 * @typedef {{messages:MailMessage[]}} MailThread
 */
export class EmailProvider {
 async inbox(_query,_max){throw new Error('Not implemented')}
 async search(_query){throw new Error('Not implemented')}
 async message(_id){throw new Error('Not implemented')}
 async thread(_id){throw new Error('Not implemented')}
 async draft(_payload){throw new Error('Not implemented')}
 async send(_payload){throw new Error('Not implemented')}
 async trash(_id){throw new Error('Not implemented')}
}
/** Future Microsoft Graph adapter. No Outlook OAuth or Graph permissions requested yet. */
export class OutlookProvider extends EmailProvider {}
