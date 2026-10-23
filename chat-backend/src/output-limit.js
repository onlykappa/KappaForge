// A completed transport that hit its output cap is partial work, not an unhealthy model.
export class OutputLimitError extends Error{
 constructor(usage=null){super('Response reached the output limit');this.usage=usage;}
}
