# Reproduces the sampler edit of Lfm3ForCausalLM.js (PATCHES.md): applied to the penalty-only bundle,
#   git show 8708743:browser_demo/vendor/lfm3-webgpu-pi/Lfm3ForCausalLM.js > /tmp/base.js
#   python3 patch_sampler.py /tmp/base.js Lfm3ForCausalLM.js
# vLLM order and semantics.
import sys
SRC=sys.argv[1]
DST=sys.argv[2]
s=open(SRC).read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count,(s.count(old),old[:100])
    s=s.replace(old,new)

# Buffer layout (u32 words), W = ceil(vocab/32):
#   [0,W) seen bitmap (prompt + output)   W+0 repetition f32   W+1 top_k (0 = greedy)   W+2 temperature f32
#   W+3 top_p f32   W+4 min_p f32   W+5 seed   W+6 tokens generated this call   W+7 flags (1 freq/pres, 2 bias, 4 min_tokens)
#   W+8 frequency f32   W+9 presence f32   W+10 min_tokens   W+11 stop id count (<=4)   W+12..15 stop ids
#   [W+16, W+16+32W) output counts   [W+16+32W, W+16+64W) logit bias f32
ADJ=('struct Adj{pen:f32,flags:u32,freq:f32,pres:f32,mask:bool};'
 'fn load_adj()->Adj{var a:Adj;a.pen=bitcast<f32>(seen_in[SEEN_WORDS]);a.flags=seen_in[SEEN_WORDS+7u];a.freq=bitcast<f32>(seen_in[SEEN_WORDS+8u]);a.pres=bitcast<f32>(seen_in[SEEN_WORDS+9u]);a.mask=(a.flags&4u)!=0u&&seen_in[SEEN_WORDS+6u]<seen_in[SEEN_WORDS+10u];return a;}\n'
 'fn adjust_logit(l:f32,v:u32,a:Adj)->f32{var x=l;'
 'if((a.flags&2u)!=0u){x=x+bitcast<f32>(seen_in[SEEN_WORDS+16u+SEEN_WORDS*32u+v]);}'
 'if(a.mask){let ns=min(seen_in[SEEN_WORDS+11u],4u);for(var i=0u;i<ns;i=i+1u){if(seen_in[SEEN_WORDS+12u+i]==v){x=-3.4028234663852886e38;}}}'
 'if(a.pen>0.0&&a.pen!=1.0&&((seen_in[v>>5u]>>(v&31u))&1u)!=0u){x=select(x*a.pen,x/a.pen,x>0.0);}'
 'if((a.flags&1u)!=0u){let c=seen_in[SEEN_WORDS+16u+v];if(c>0u){x=x-a.freq*f32(c);x=x-a.pres;}}'
 'return x;}\n')
NOTE=('fn note_token(t:u32){if(t<SEEN_WORDS*32u){let pen=bitcast<f32>(seen_io[SEEN_WORDS]);if(pen>0.0&&pen!=1.0){let w=t>>5u;seen_io[w]=seen_io[w]|(1u<<(t&31u));}'
 'if((seen_io[SEEN_WORDS+7u]&1u)!=0u){seen_io[SEEN_WORDS+16u+t]=seen_io[SEEN_WORDS+16u+t]+1u;}}'
 'seen_io[SEEN_WORDS+6u]=seen_io[SEEN_WORDS+6u]+1u;}\n')
PICK=('fn pcg(v:u32)->u32{let st=v*747796405u+2891336453u;let w=((st>>((st>>28u)+4u))^st)*277803737u;return (w>>22u)^w;}\n'
 'fn sample_pick(K:u32,temp:f32,top_p:f32,min_p:f32,seed:u32,ctr:u32)->u32{var p:array<f32,64>;let t0=top_v[0];'
 'for(var i=0u;i<K;i=i+1u){p[i]=exp((top_v[i]-t0)/temp);}'
 'var n=K;'
 'if(min_p>0.0){var m=1u;for(var i=1u;i<n;i=i+1u){if(p[i]>=min_p){m=i+1u;}else{break;}}n=m;}'
 'if(top_p<1.0){var sum=0.0;for(var i=0u;i<n;i=i+1u){sum=sum+p[i];}var cum=0.0;var m=n;for(var i=0u;i<n;i=i+1u){if(cum>=top_p*sum){m=i;break;}cum=cum+p[i];}n=max(m,1u);}'
 'var tot=0.0;for(var i=0u;i<n;i=i+1u){tot=tot+p[i];}'
 'let u=f32(pcg(seed^pcg(ctr+0x9e3779b9u))>>8u)*(1.0/16777216.0)*tot;'
 'var acc=0.0;var pick=top_i[n-1u];for(var i=0u;i<n;i=i+1u){acc=acc+p[i];if(u<acc){pick=top_i[i];break;}}return pick;}\n')

# ---- A. head kernel manifest
rep('seenT:{onnx:"Seen",dtype:"uint32",rank:1,optional:!0}},outputs:{bestValuesT:{onnx:"BestValues"',
    'seenT:{onnx:"Seen",dtype:"uint32",rank:1,optional:!0}},outputs:{candValuesT:{onnx:"CandValues",dtype:"float32",rank:1,optional:!0},candIdsT:{onnx:"CandIds",dtype:"uint32",rank:1,optional:!0},bestValuesT:{onnx:"BestValues"')
rep('seen_in:{arg:"seenT",name:"seen_in",elementType:"u32"}},variants:[{id:"ksuper"',
    'seen_in:{arg:"seenT",name:"seen_in",elementType:"u32"},cand_values_out:{arg:"candValuesT",name:"cand_values_out",elementType:"f32"},cand_ids_out:{arg:"candIdsT",name:"cand_ids_out",elementType:"u32"}},variants:[{id:"ksuper"')
rep('when:["kSuperPresent","kSuperContract","present.seenT"]','when:["kSuperPresent","kSuperContract","present.seenT","present.candValuesT","present.candIdsT"]')
rep('"best_values_out","best_ids_out","seen_in"]','"best_values_out","best_ids_out","seen_in","cand_values_out","cand_ids_out"]')
# ---- B. head kernel shader (the -seen clone only)
a0=s.find('["decode-lm-head-ksuper-argmax-tiled-seen.wgsl.jinja",`'); a1=s.find('`]',a0)
t=s[a0:a1]; t0=t
def trep(old,new):
    global t
    assert t.count(old)==1,(t.count(old),old[:80]); t=t.replace(old,new)
trep('var<workgroup>shared_acts:array<vec4<f32>,{{ hiddenSizeVec4 }}>;\n','var<workgroup>shared_acts:array<vec4<f32>,{{ hiddenSizeVec4 }}>;var<workgroup>samp_flag:u32;\n'+ADJ)
trep('shared_acts[i]=hidden4(i)*vec4<f32>(norm_weight[W_NORM_VEC4+i]);}workgroupBarrier();var best_token=0u;var best_value=F32_MIN;let pen=bitcast<f32>(seen_in[SEEN_WORDS]);let pen_on=pen>0.0&&pen!=1.0;',
     'shared_acts[i]=hidden4(i)*vec4<f32>(norm_weight[W_NORM_VEC4+i]);}if(lid==0u){samp_flag=seen_in[SEEN_WORDS+1u];}workgroupBarrier();var best_token=0u;var best_value=F32_MIN;let adj=load_adj();')
trep('var acc=acc0;if(pen_on&&((seen_in[vocab>>5u]>>(vocab&31u))&1u)!=0u){acc=select(acc*pen,acc/pen,acc>0.0);}if(acc>best_value)','let acc=adjust_logit(acc0,vocab,adj);if(acc>best_value)')
SORT=('let samp_on=workgroupUniformLoad(&samp_flag)!=0u;\n'
 'if(samp_on){if(best_value!=best_value){best_value=F32_MIN;}best_values[lid]=best_value;best_indices[lid]=best_token;workgroupBarrier();'
 'for(var k=2u;k<=WORKGROUP_SIZE;k=k<<1u){for(var j=k>>1u;j>0u;j=j>>1u){let ixj=lid^j;if(ixj>lid){let vi=best_values[lid];let vj=best_values[ixj];let ii=best_indices[lid];let ij=best_indices[ixj];let i_better=(vi>vj)||(vi==vj&&ii<ij);let up=((lid&k)==0u);if(up!=i_better){best_values[lid]=vj;best_values[ixj]=vi;best_indices[lid]=ij;best_indices[ixj]=ii;}}workgroupBarrier();}}'
 'if(lid<64u){cand_values_out[block*64u+lid]=best_values[lid];cand_ids_out[block*64u+lid]=best_indices[lid];}}else{\n')
trep('{% endif %}{% include "ops/_shared/argmax-wg-tree.13d09b6502.wgsl.jinja" %}}','{% endif %}'+SORT+'{% include "ops/_shared/argmax-wg-tree.13d09b6502.wgsl.jinja" %}}}')
s=s[:a0]+t+s[a1:]

# ---- C. CandidateArgMax: greedy writes and notes only when sampling is off; longer seen buffer
rep('SEEN_LEN:"args.seenWords + 1"','SEEN_LEN:"args.seenWords * 65 + 16"')
rep('{% if hasSeen %}const SEEN_WORDS:u32={{ seenWords }}u;{% endif %}','{% if hasSeen %}const SEEN_WORDS:u32={{ seenWords }}u;\n'+NOTE+'{% endif %}')
rep('token_out[OUTPUT_OFFSET]=best_index;{% if hasSeen %}{let pen=bitcast<f32>(seen_io[SEEN_WORDS]);if(pen>0.0&&pen!=1.0&&best_index<SEEN_WORDS*32u){let w=best_index>>5u;seen_io[w]=seen_io[w]|(1u<<(best_index&31u));}}{% endif %}}',
    '{% if hasSeen %}if(seen_io[SEEN_WORDS+1u]==0u){token_out[OUTPUT_OFFSET]=best_index;note_token(best_index);}{% else %}token_out[OUTPUT_OFFSET]=best_index;{% endif %}}')
rep('token_out[OUTPUT_OFFSET]=best_indices[0];{% if hasSeen %}{let pen=bitcast<f32>(seen_io[SEEN_WORDS]);let bi=best_indices[0];if(pen>0.0&&pen!=1.0&&bi<SEEN_WORDS*32u){let w=bi>>5u;seen_io[w]=seen_io[w]|(1u<<(bi&31u));}}{% endif %}}',
    ' {% if hasSeen %}if(seen_io[SEEN_WORDS+1u]==0u){token_out[OUTPUT_OFFSET]=best_indices[0];note_token(best_indices[0]);}{% else %}token_out[OUTPUT_OFFSET]=best_indices[0];{% endif %}}')

# ---- D. merge + sample op
WGSL=('{{ env.wgsl.resourceDeclarations }}\n'
 'const NUM_LISTS:u32={{ numLists }}u;const LIST_LEN:u32=64u;const WG:u32=256u;const SEEN_WORDS:u32={{ seenWords }}u;const OUTPUT_OFFSET:u32={{ outputOffset }}u;const NEG:f32=-3.4028234663852886e38;const NONE:u32=0xffffffffu;\n'
 'var<workgroup>red_v:array<f32,256>;var<workgroup>red_i:array<u32,256>;var<workgroup>top_v:array<f32,64>;var<workgroup>top_i:array<u32,64>;var<workgroup>flag:u32;\n'
 'fn better(av:f32,ai:u32,bv:f32,bi:u32)->bool{return av>bv||(av==bv&&ai<bi);}\n'+NOTE+PICK+
 '@compute@workgroup_size(256)fn main(@builtin(local_invocation_id)l3:vec3<u32>){let lid=l3.x;\n'
 'if(lid==0u){flag=seen_io[SEEN_WORDS+1u];}\n'
 'let topk=workgroupUniformLoad(&flag);\n'
 'if(topk==0u){return;}\n'
 'let l0=lid;let l1=lid+WG;var p0=0u;var p1=0u;var v0=NEG;var i0=NONE;var v1=NEG;var i1=NONE;\n'
 'if(l0<NUM_LISTS){v0=cand_values[l0*LIST_LEN];i0=cand_ids[l0*LIST_LEN];}\n'
 'if(l1<NUM_LISTS){v1=cand_values[l1*LIST_LEN];i1=cand_ids[l1*LIST_LEN];}\n'
 'let K=min(topk,LIST_LEN);\n'
 'for(var s=0u;s<K;s=s+1u){var bv=v0;var bi=i0;if(better(v1,i1,bv,bi)){bv=v1;bi=i1;}\n'
 'red_v[lid]=bv;red_i[lid]=bi;workgroupBarrier();\n'
 'var st=WG/2u;loop{if(lid<st){if(better(red_v[lid+st],red_i[lid+st],red_v[lid],red_i[lid])){red_v[lid]=red_v[lid+st];red_i[lid]=red_i[lid+st];}}workgroupBarrier();if(st==1u){break;}st=st/2u;}\n'
 'let wv=red_v[0];let wi=red_i[0];workgroupBarrier();\n'
 'if(lid==0u){top_v[s]=wv;top_i[s]=wi;}\n'
 'if(i0==wi){p0=p0+1u;if(p0<LIST_LEN){v0=cand_values[l0*LIST_LEN+p0];i0=cand_ids[l0*LIST_LEN+p0];}else{v0=NEG;i0=NONE;}}\n'
 'if(i1==wi){p1=p1+1u;if(p1<LIST_LEN){v1=cand_values[l1*LIST_LEN+p1];i1=cand_ids[l1*LIST_LEN+p1];}else{v1=NEG;i1=NONE;}}\n'
 '}\n'
 'workgroupBarrier();\n'
 'if(lid==0u){let pick=sample_pick(K,bitcast<f32>(seen_io[SEEN_WORDS+2u]),bitcast<f32>(seen_io[SEEN_WORDS+3u]),bitcast<f32>(seen_io[SEEN_WORDS+4u]),seen_io[SEEN_WORDS+5u],seen_io[SEEN_WORDS+6u]);'
 'token_out[OUTPUT_OFFSET]=pick;note_token(pick);}\n'
 '}')
assert '`' not in WGSL and '${' not in WGSL and '{{%' not in WGSL
MANI=('["com.xenova.SampleTopKMerge",{manifest:{domain:"com.xenova",name:"SampleTopKMerge",sinceVersion:1,'
 'inputs:{valuesT:{onnx:"CandValues",dtype:"float32",rank:1},indicesT:{onnx:"CandIds",dtype:"uint32",rank:1}},'
 'outputs:{outT:{onnx:"Output",dtype:"uint32",rank:1},seenT:{onnx:"Seen",dtype:"uint32",rank:1}},'
 'args:{numLists:{kind:"u32",onnx:"num_lists"},seenWords:{kind:"u32",onnx:"seen_words"},outputOffset:{kind:"u32",onnx:"output_offset",required:!1}},'
 'derive:{outputOffset:"args.outputOffset if args.outputOffset else 0",TOKEN_OUT_LEN:"outputOffset + 1",SEEN_LEN:"args.seenWords * 65 + 16"},'
 'when:["ranks.valuesT == 1","ranks.indicesT == 1","ranks.outT == 1","ranks.seenT == 1",\'tensorDtypes.valuesT == "float32"\',\'tensorDtypes.indicesT == "uint32"\',\'tensorDtypes.outT == "uint32"\',\'tensorDtypes.seenT == "uint32"\',"args.numLists > 0","args.numLists <= 512","dim(shapes.valuesT, 0) >= args.numLists * 64","dim(shapes.indicesT, 0) >= args.numLists * 64","dim(shapes.outT, 0) > outputOffset"],'
 'variants:[{id:"main",priority:0,derive:{numLists:"args.numLists",seenWords:"args.seenWords"},passes:[{id:"main",name:"SampleTopKMerge",shader:"sample-topk-merge.wgsl.jinja",'
 'bindings:[{arg:"valuesT",name:"cand_values"},{arg:"indicesT",name:"cand_ids"},{arg:"outT",name:"token_out",length:"$TOKEN_OUT_LEN"},{arg:"seenT",name:"seen_io",length:"$SEEN_LEN"}],dispatch:{x:1}}]}]},'
 'assets:[["sample-topk-merge.wgsl.jinja",`'+WGSL+'`]]}],')
rep('["com.xenova.StridedCopy",{manifest:',MANI+'["com.xenova.StridedCopy",{manifest:')

# ---- E. head emitter
rep('u=e.scratch(`${i}bestValues`,"float32",[o]),l=e.scratch(`${i}bestIds`,"uint32",[o]);if(t.q1)',
    'u=e.scratch(`${i}bestValues`,"float32",[o]),l=e.scratch(`${i}bestIds`,"uint32",[o]),CV=SEEN?e.scratch(`${i}cand.values`,"float32",[o*64]):null,CI=SEEN?e.scratch(`${i}cand.ids`,"uint32",[o*64]):null;if(t.q1)')
rep('bestValuesT:u,bestIdsT:l,...SEEN?{seenT:SEEN}:{}},','bestValuesT:u,bestIdsT:l,...SEEN?{seenT:SEEN,candValuesT:CV,candIdsT:CI}:{}},')
rep('count:o,...SEEN?{seenWords:Math.ceil(t.vocabSize/32)}:{}}}),e.nodeCount-r}function bT',
    'count:o,...SEEN?{seenWords:Math.ceil(t.vocabSize/32)}:{}}}),SEEN&&e.op("com.xenova.SampleTopKMerge",{valuesT:CV,indicesT:CI,outT:t.ids,seenT:SEEN},{args:{numLists:o,seenWords:Math.ceil(t.vocabSize/32),outputOffset:t.outputOffset??0}}),e.nodeCount-r}function bT')
# sampling needs one vocabulary entry per head thread: o blocks x 256 threads must cover the vocabulary
rep('SEEN=t.seen&&!t.q1&&n&&!s&&t.model.canRepetitionPenalty?.()?t.seen:null,',
    'SEEN=t.seen&&!t.q1&&n&&!s&&t.model.canRepetitionPenalty?.()?t.seen:null,')

# ---- F. model methods
rep('canSample(){return fs(this.config)&&Ud(this)}','canSample(){return fs(this.config)&&Ud(this)||this.canRepetitionPenalty()}')
rep('let r=Math.ceil(this.config.vocab_size/32)+1;t.repSeen=','let r=Math.ceil(this.config.vocab_size/32)*65+16;t.repSeen=')
k0=s.find('seedRepetition(t,r,n){'); k1=s.find('this.runtime.host.writeBuffer(s.buffer,0,o)}',k0)+len('this.runtime.host.writeBuffer(s.buffer,0,o)}')
assert k0>0 and k1>k0
NEW=('seedSampling(t,pn,n,sp,eos){let on=!!(pn||sp);if(!this.canRepetitionPenalty()){if(on)throw new Error("sampling and penalties need the single-stage q6_k lm_head (this model\'s output head is not supported)");return}'
 'if(!on&&!t.repSeen)return;let s=this.repSeenFor(t),W=Math.ceil(this.config.vocab_size/32),V=this.config.vocab_size,h=new Uint32Array(16),f=new Float32Array(h.buffer),q=this.runtime.host;'
 'let rep=pn?.repetition??1,fq=pn?.frequency??0,pr=pn?.presence??0,bias=pn?.bias??null,mt=pn?.minTokens??0;'
 'let bm=new Uint32Array(W);if(rep!==1){for(let u of n)u>=0&&u<V&&(bm[u>>>5]|=1<<(u&31));f[0]=rep}'
 'if(sp){h[1]=sp.top_k;f[2]=sp.temperature;f[3]=sp.top_p;f[4]=sp.min_p;h[5]=sp.seed>>>0}'
 'let fl=(fq!==0||pr!==0?1:0)|(bias?2:0)|(mt>0?4:0);h[7]=fl;f[8]=fq;f[9]=pr;h[10]=mt;'
 'let st=(Array.isArray(eos)?eos:eos==null?[]:[eos]).filter(u=>Number.isInteger(u)&&u>=0).slice(0,4);h[11]=st.length;st.forEach((u,i)=>h[12+i]=u);'
 'q.writeBuffer(s.buffer,0,bm);q.writeBuffer(s.buffer,W*4,h);'
 'if(fl&1||t.repCountsDirty){q.writeBuffer(s.buffer,(W+16)*4,new Uint32Array(W*32));t.repCountsDirty=!!(fl&1)}'
 'if(bias||t.repBiasDirty){let b=new Float32Array(W*32);if(bias)for(let[u,v]of bias){if(u>=V)throw new RangeError(`logit_bias: ${u} is not a token id (vocabulary ${V})`);b[u]=v}q.writeBuffer(s.buffer,(W+16+W*32)*4,b);t.repBiasDirty=!!bias}}')
s=s[:k0]+NEW+s[k1:]
rep('if(i){if(o)throw new Error("speculative decoding verifies greedy drafts; it cannot sample");if(a.repetition_penalty!==void 0&&a.repetition_penalty!==1)throw new Error("speculative decoding cannot apply a repetition penalty");',
    'if(i){if(o)throw new Error("speculative decoding verifies greedy drafts; it cannot sample");if(a.penalties)throw new Error("speculative decoding cannot apply penalties or a logit bias");')
rep('let u=this.#f(n,{eosTokenId:s,pipelineDepth:Ls(a,NT,_r),sampling:o,repetitionPenalty:a.repetition_penalty,seenIds:a.seen_ids});',
    'let u=this.#f(n,{eosTokenId:s,pipelineDepth:Ls(a,NT,_r),sampling:o,penalties:a.penalties,seenIds:a.seen_ids});')
rep('#f(t,{eosTokenId:r,pipelineDepth:n,sampling:s,repetitionPenalty:RP,seenIds:SI}){return{cache:t,eosTokenId:r,pipelineDepth:n,sampling:s,prefill:(a,o,i)=>(this.seedRepetition(t,RP,SI??a),this.#m(t,a,o,i,s)),',
    '#f(t,{eosTokenId:r,pipelineDepth:n,sampling:s,penalties:PN,seenIds:SI}){return{cache:t,eosTokenId:r,pipelineDepth:n,sampling:s,prefill:(a,o,i)=>(this.seedSampling(t,PN??null,SI??a,s,r),this.#m(t,a,o,i,s)),')
rep('setSampling(t){if(t!==null&&!this.#n)throw zA(this.#e);this.#r.set(t)}','setSampling(t){this.#r.set(t)}')
rep('setSampling(t){if(t!==null&&!this.#n)throw zA(this.emission.graph);this.#r.set(t)}','setSampling(t){this.#r.set(t)}')
# ---- G. options: chat session -> streamTokens -> model
rep('...t.repetitionPenalty!==void 0?{repetition_penalty:t.repetitionPenalty,seen_ids:t.seenIds}:{}})}get decodePipelineDepth',
    '...t.penalties?{penalties:t.penalties,seen_ids:t.seenIds}:{}})}get decodePipelineDepth')
rep('repetitionPenalty:RP,seenIds:b})}','penalties:RP,seenIds:b})}')
rep('f=this.#w(r),RP=Rr_(r.repetition_penalty),p=qw(r.stop_strings)','f=this.#w(r),RP=Pn_(r),p=qw(r.stop_strings)')
rep('function Rr_(e){',
 'function Pn_(e,V){let rep=Rr_(e.repetition_penalty),num=(k,lo,hi)=>{let v=e[k];if(v===void 0)return 0;if(typeof v!="number"||!Number.isFinite(v)||v<lo||v>hi)throw new RangeError(`${k} must be a number in [${lo}, ${hi}], got ${String(v)}`);return v},'
 'fq=num("frequency_penalty",-2,2),pr=num("presence_penalty",-2,2),mt=e.min_tokens??0,bias=null;'
 'if(!Number.isInteger(mt)||mt<0)throw new RangeError(`min_tokens must be an integer >= 0, got ${String(mt)}`);'
 'if(e.logit_bias!==void 0&&e.logit_bias!==null){if(typeof e.logit_bias!="object")throw new RangeError("logit_bias must be an object of token id -> bias");bias=new Map;for(let[k,v]of Object.entries(e.logit_bias)){let u=Number(k);if(!Number.isInteger(u)||u<0||V!==void 0&&u>=V)throw new RangeError(`logit_bias: ${k} is not a token id`);if(typeof v!="number"||!Number.isFinite(v))throw new RangeError(`logit_bias[${k}] must be a finite number`);bias.set(u,Math.max(-100,Math.min(100,v)))}if(bias.size===0)bias=null}'
 'return rep===1&&fq===0&&pr===0&&mt===0&&!bias?null:{repetition:rep,frequency:fq,presence:pr,minTokens:mt,bias}}function Rr_(e){')
# session: an explicit temperature / top_k / top_p / min_p turns sampling on (temperature 0 or top_k 1 stays greedy)
rep('return Rn({do_sample:t.do_sample??r.do_sample,','return Rn({do_sample:t.do_sample??((t.temperature!==void 0||t.top_k!==void 0||t.top_p!==void 0||t.min_p!==void 0)?!0:r.do_sample),')
# Rn: top_k unset, 0 or -1 = every candidate (64); vLLM's default is the whole vocabulary
rep('let t=e.temperature??1,r=e.top_k??50,','let t=e.temperature??1,r=e.top_k===void 0||e.top_k===0||e.top_k===-1?ws:e.top_k,')
open(DST,'w').write(s)
print('ok')
# ---- H. test hook (inert unless a test page sets globalThis.__lfm3SamplingDebug = {})
s=open(DST).read()
def rep2(old,new):
    global s
    assert s.count(old)==1,(s.count(old),old[:80]); s=s.replace(old,new)
rep2('q.writeBuffer(s.buffer,0,bm);q.writeBuffer(s.buffer,W*4,h);',
     'q.writeBuffer(s.buffer,0,bm);q.writeBuffer(s.buffer,W*4,h);{let D=globalThis.__lfm3SamplingDebug;D&&(D.state={tensor:s,runtime:this.runtime,W,V},D.promptIds=[...n],D.out=[])}')
rep2('n.generated(),w.push(V)','n.generated(),w.push(V),globalThis.__lfm3SamplingDebug?.out?.push(V)')
open(DST,'w').write(s)
print('hook ok')
s=open(DST).read()
old='canRepetitionPenalty(){return this.lmHeadFormat==="q6_k"&&'
assert s.count(old)==1
s=s.replace(old,'canRepetitionPenalty(){return this.config.vocab_size<=131072&&this.lmHeadFormat==="q6_k"&&')
open(DST,'w').write(s); print('vocab guard ok')
# ---- I. true logits: the fused head skips the final RMSNorm's 1/rms (argmax does not need it);
#         sampling and the additive adjustments do. Each head workgroup computes it.
s=open(DST).read()
a0=s.find('["decode-lm-head-ksuper-argmax-tiled-seen.wgsl.jinja",`'); a1=s.find('`]',a0)
t=s[a0:a1]
def trep(old,new):
    global t
    assert t.count(old)==1,(t.count(old),old[:80]); t=t.replace(old,new)
trep('const NUM_BLOCKS:u32={{ numBlocks }}u;const SEEN_WORDS:u32={{ seenWords }}u;','const NUM_BLOCKS:u32={{ numBlocks }}u;const SEEN_WORDS:u32={{ seenWords }}u;const RMS_EPS:f32={{ rmsEps }};')
trep('for(var i=lid;i<HIDDEN_SIZE_VEC4;i=i+WORKGROUP_SIZE){shared_acts[i]=hidden4(i)*vec4<f32>(norm_weight[W_NORM_VEC4+i]);}if(lid==0u){samp_flag=seen_in[SEEN_WORDS+1u];}workgroupBarrier();',
     'var ss=0.0;for(var i=lid;i<HIDDEN_SIZE_VEC4;i=i+WORKGROUP_SIZE){let h=hidden4(i);ss=ss+dot(h,h);shared_acts[i]=h*vec4<f32>(norm_weight[W_NORM_VEC4+i]);}best_values[lid]=ss;if(lid==0u){samp_flag=seen_in[SEEN_WORDS+1u];}workgroupBarrier();'
     'var rs=WORKGROUP_SIZE/2u;loop{if(rs==0u){break;}if(lid<rs){best_values[lid]=best_values[lid]+best_values[lid+rs];}workgroupBarrier();rs=rs/2u;}'
     'let inv_rms=1.0/sqrt(best_values[0]/f32(HIDDEN_SIZE_VEC4*4u)+RMS_EPS);workgroupBarrier();')
trep('let adj=load_adj();','let adj=load_adj();let scaled=seen_in[SEEN_WORDS+1u]!=0u||(adj.flags&3u)!=0u;')
trep('let acc=adjust_logit(acc0,vocab,adj);','let acc=adjust_logit(select(acc0,acc0*inv_rms,scaled),vocab,adj);')
s=s[:a0]+t+s[a1:]
old='vocabTileSize:"tunables.WORKGROUP_SIZE",seenWords:"ceilDiv(args.vocabSize, 32)"}'
assert s.count(old)==1
s=s.replace(old,'vocabTileSize:"tunables.WORKGROUP_SIZE",seenWords:"ceilDiv(args.vocabSize, 32)",rmsEps:"args.rmsEps"}')
old='bestValuesT:u,bestIdsT:l,...SEEN?{seenT:SEEN,candValuesT:CV,candIdsT:CI}:{}},{args:{hiddenSize:t.hiddenSize,vocabSize:t.vocabSize,lmHeadOffset:0,finalNormOffset:t.finalNormOffset,numBlocks:o,'
assert s.count(old)==1,s.count(old)
s=s.replace(old,old+'...SEEN?{rmsEps:t.rmsEps}:{},')
open(DST,'w').write(s); print('rms ok')
# ---- J. the merge leaves the 64 logits it sampled from (adjusted, before temperature) in a dump region
#         after the bias: words [65W+16, 65W+144). Tests read it to separate sampler error from engine error.
s=open(DST).read()
for old,new in [('SEEN_LEN:"args.seenWords * 65 + 16"','SEEN_LEN:"args.seenWords * 65 + 144"'),
                ('let r=Math.ceil(this.config.vocab_size/32)*65+16;t.repSeen=','let r=Math.ceil(this.config.vocab_size/32)*65+144;t.repSeen=')]:
    n=s.count(old); assert n>=1,(old,n); s=s.replace(old,new)
old='workgroupBarrier();\nif(lid==0u){let pick=sample_pick('
assert s.count(old)==1
s=s.replace(old,'workgroupBarrier();\nif(lid<64u){let D=SEEN_WORDS*65u+16u;if(lid<K){seen_io[D+lid]=bitcast<u32>(top_v[lid]);seen_io[D+64u+lid]=top_i[lid];}else{seen_io[D+lid]=0u;seen_io[D+64u+lid]=0xffffffffu;}}\nif(lid==0u){let pick=sample_pick(')
open(DST,'w').write(s); print('dump ok', s.count('* 65 + 144'))
# ---- K. always forward the full prompt ids (the test hook reads them even with no penalty)
s=open(DST).read()
old='...t.penalties?{penalties:t.penalties,seen_ids:t.seenIds}:{}})}get decodePipelineDepth'
assert s.count(old)==1
s=s.replace(old,'...t.penalties?{penalties:t.penalties}:{},...t.seenIds?{seen_ids:t.seenIds}:{}})}get decodePipelineDepth')
open(DST,'w').write(s); print('seen ids ok')
