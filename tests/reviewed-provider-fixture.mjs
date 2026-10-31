// A simulated account's reviewed routes, for tests of unrelated transport logic.
// Never imported by shipped code; this is not a production free-price claim or a
// runtime/environment escape hatch. Production metadata is restored after use.
import registry from '../config/providers.json' with {type:'json'};
export function reviewedProviderFixture(id,models){
 const provider=registry.providers[id],original={models:provider.models,freeModels:provider.freeModels},
  hadModels=Object.hasOwn(provider,'models'),hadReview=Object.hasOwn(provider,'freeModels');
 provider.models=[...models];provider.freeModels=[...models];
 return ()=>{if(hadModels)provider.models=original.models;else delete provider.models;
  if(hadReview)provider.freeModels=original.freeModels;else delete provider.freeModels;};
}
