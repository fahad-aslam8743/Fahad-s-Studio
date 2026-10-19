// Model IDs and parameters verified against fal.ai's model API pages on 2026-10-19.
// Prices are estimates, NOT guaranteed; check the provider pricing before spending.
export const VIDEO_MODELS=Object.freeze({
 text:Object.freeze({id:'wan/v2.6/text-to-video',durations:[5,10,15],aspects:['16:9','9:16','1:1','4:3','3:4'],resolutions:['720p','1080p'],usdPerSecond:{'720p':0.10,'1080p':0.15}}),
 image:Object.freeze({id:'wan/v2.6/image-to-video',durations:[5,10,15],aspects:null,resolutions:['720p','1080p'],usdPerSecond:{'720p':0.10,'1080p':0.15}})
});
export const DIRECTOR_TEMPLATE='You are a professional film director and video-prompt engineer. Turn the user concept into a precise shot brief. Return valid JSON only, with strings subject, action, shotType, lens, cameraMovement, lighting, colorGrade, mood, styleReferences, negativePrompt, and values duration (one of 5,10,15) and aspectRatio (16:9,9:16,1:1,4:3,3:4). Do not claim any video has been generated. Avoid imitating living artists by name.';
