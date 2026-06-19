var i=Object.freeze({maxRetries:2,retryDelay:400,retryBackoff:2});function y(e){return new Promise(t=>window.setTimeout(t,e))}async function v(e,t={}){let{maxRetries:r=i.maxRetries,retryDelay:n=i.retryDelay,retryBackoff:o=i.retryBackoff,shouldRetry:d=()=>!0,sleep:u=y,onRetry:k=()=>{}}=t,s=0;for(;;)try{return await e(s)}catch(l){if(s>=r||!d(l,s))throw l;let a=n*o**s;k(l,s+1,a),await u(a),s+=1}}function f(e){return e===408||e===425||e===429||e>=500}function m(e){return e?.retryable===!0||e?.name==="AbortError"||e instanceof TypeError}async function p(e,t={}){try{return await v(async r=>{let n=await e(r);if(!f(n.status))return n;let o=new Error(`Retryable HTTP status: ${n.status}`);throw o.retryable=!0,o.retryResponse=n,o},{...t,shouldRetry:t.shouldRetry||m})}catch(r){if(r?.retryResponse)return r.retryResponse;throw r}}function x({scrollLeft:e,scrollWidth:t,clientWidth:r}){let n=Math.max(0,t-r),o=4;return{canScrollBackward:e>o,canScrollForward:e<n-o}}function c(e){let t=Number(e);return Number.isFinite(t)?Math.max(1,Math.min(8,Math.floor(t))):1}function h(e){return Array.from({length:c(e)},()=>`
    <div class="skeleton-card">
      <div class="skeleton skeleton-line skeleton-line--short"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line skeleton-line--medium"></div>
    </div>
  `).join("")}function w(){return`
    <div class="skeleton-detail">
      <div class="skeleton skeleton-line skeleton-line--short"></div>
      <div class="skeleton skeleton-block"></div>
      <div class="skeleton skeleton-line"></div>
      <div class="skeleton skeleton-line skeleton-line--medium"></div>
    </div>
  `}function R(e){return Array.from({length:c(e)},()=>`
    <div class="skeleton-stat">
      <div class="skeleton skeleton-line skeleton-line--short"></div>
      <div class="skeleton skeleton-number"></div>
    </div>
  `).join("")}function S(e,t=1){let r={list:()=>h(t),detail:w,stats:()=>R(t)},n=r[e]||r.detail;return`<div class="skeleton-group" data-skeleton="${e}" aria-hidden="true">${n()}</div>`}export{p as a,x as b,S as c};
