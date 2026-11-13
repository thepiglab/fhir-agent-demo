/* @ts-self-types="./lfm3_web.d.ts" */

export class Engine {
    static __wrap(ptr) {
        const obj = Object.create(Engine.prototype);
        obj.__wbg_ptr = ptr;
        EngineFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_engine_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    adapter() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_adapter(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {Uint32Array | number[]} ids
     * @param {boolean} skip_special
     * @returns {string}
     */
    decode(ids, skip_special) {
        let deferred3_0;
        let deferred3_1;
        try {
            const val2 = +skip_special;
            const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_decode(this.__wbg_ptr, ptr0, len0, val2);
            deferred3_0 = ret[0];
            deferred3_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Tokenize text (special tokens parsed, no BOS added: the template writes it).
     * @param {string} text
     * @returns {Uint32Array}
     */
    encode(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_encode(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Generate after `prompt` (the whole conversation; its common prefix with the previous call is reused).
     * `on_tokens(Uint32Array) -> bool` after every chunk of `chunk` tokens (false cancels). Resolves to
     * `{tokens: Uint32Array, finish: "stop"|"length"|"cancelled", prompt_tokens, cached_tokens, prefill_ms, decode_ms}`.
     * @param {Uint32Array | number[]} prompt
     * @param {string} params_json
     * @param {number} max_new
     * @param {number} chunk
     * @param {Function} on_tokens
     * @returns {Promise<any>}
     */
    generate(prompt, params_json, max_new, chunk, on_tokens) {
        const val3 = +max_new;
        const val4 = +chunk;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passArray32ToWasm0(prompt, wasm.__wbindgen_malloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(params_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 4, 4); }
            throw e;
        }
        const ret = wasm.engine_generate(this.__wbg_ptr, ptr0, len0, ptr1, len1, val3, val4, on_tokens);
        return ret;
    }
    /**
     * Stream the GGUF through `fetch_range(offset, len) -> Promise<Uint8Array>` onto the GPU.
     * `on_progress(done_bytes, total_bytes)` is called after every tensor.
     * @param {Function} fetch_range
     * @param {number} file_len
     * @param {number} max_ctx
     * @param {Function} on_progress
     * @returns {Promise<Engine>}
     */
    static load(fetch_range, file_len, max_ctx, on_progress) {
        const ret = wasm.engine_load(fetch_range, file_len, max_ctx, on_progress);
        return ret;
    }
    /**
     * @returns {number}
     */
    max_ctx() {
        const ret = wasm.engine_max_ctx(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * a GGUF metadata value as JSON-ish text (e.g. "tokenizer.chat_template")
     * @param {string} key
     * @returns {string | undefined}
     */
    meta_str(key) {
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_meta_str(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    /**
     * A streaming splitter for one reply. `in_think`: the prompt ended with `<think>`. `stop_ids` are not decoded.
     * @param {boolean} in_think
     * @param {string | null | undefined} tools_json
     * @param {Uint32Array | number[]} stop_ids
     * @returns {TextStream}
     */
    new_stream(in_think, tools_json, stop_ids) {
        const val3 = +in_think;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = isLikeNone(tools_json) ? 0 : passStringToWasm0(tools_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passArray32ToWasm0(stop_ids, wasm.__wbindgen_malloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 4, 4); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.engine_new_stream(this.__wbg_ptr, val3, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return TextStream.__wrap(ret[0]);
    }
    /**
     * Parse a whole reply into {reasoning, content, tool_calls: [{name, arguments, errors?}], errors} (JSON).
     * @param {string} text
     * @param {string | null} [tools_json]
     * @returns {string}
     */
    parse_reply(text, tools_json) {
        let deferred4_0;
        let deferred4_1;
        try {
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = isLikeNone(tools_json) ? 0 : passStringToWasm0(tools_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
                throw e;
            }
            const ret = wasm.engine_parse_reply(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Render the GGUF's chat template (messages and tools as JSON text), with the generation prompt.
     * @param {string} messages_json
     * @param {string | null | undefined} tools_json
     * @param {boolean} enable_thinking
     * @returns {string}
     */
    render_chat(messages_json, tools_json, enable_thinking) {
        let deferred5_0;
        let deferred5_1;
        try {
            const val3 = +enable_thinking;
            let ptr0, len0, ptr1, len1;
            try {
                ptr0 = passStringToWasm0(messages_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len0 = WASM_VECTOR_LEN;
                ptr1 = isLikeNone(tools_json) ? 0 : passStringToWasm0(tools_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
                len1 = WASM_VECTOR_LEN;
            } catch (e) {
                if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
                if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
                throw e;
            }
            const ret = wasm.engine_render_chat(this.__wbg_ptr, ptr0, len0, ptr1, len1, val3);
            var ptr4 = ret[0];
            var len4 = ret[1];
            if (ret[3]) {
                ptr4 = 0; len4 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred5_0 = ptr4;
            deferred5_1 = len4;
            return getStringFromWasm0(ptr4, len4);
        } finally {
            wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * Start a new sequence (drop the KV prefix).
     */
    reset() {
        wasm.engine_reset(this.__wbg_ptr);
    }
    /**
     * @returns {number}
     */
    seq_len() {
        const ret = wasm.engine_seq_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {string} token
     * @returns {number | undefined}
     */
    token_id(token) {
        const ptr0 = passStringToWasm0(token, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_token_id(this.__wbg_ptr, ptr0, len0);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * bytes allocated on the GPU (weights + KV cache + activations)
     * @returns {number}
     */
    vram_bytes() {
        const ret = wasm.engine_vram_bytes(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) Engine.prototype[Symbol.dispose] = Engine.prototype.free;

/**
 * Streamed assistant text: token ids in, routed reasoning / text deltas out (JSON).
 */
export class TextStream {
    static __wrap(ptr) {
        const obj = Object.create(TextStream.prototype);
        obj.__wbg_ptr = ptr;
        TextStreamFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TextStreamFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_textstream_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    finish() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.textstream_finish(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * everything generated so far, as text (markup included)
     * @returns {string}
     */
    full_text() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.textstream_full_text(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * feed generated ids; returns a JSON array of {type: "reasoning"|"text", text}
     * @param {Uint32Array | number[]} ids
     * @returns {string}
     */
    push(ids) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.textstream_push(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    reasoning_tokens() {
        const ret = wasm.textstream_reasoning_tokens(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) TextStream.prototype[Symbol.dispose] = TextStream.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_208446807d0d1e30: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Window_113a2714ede0e1b0: function(arg0) {
            const ret = arg0.Window;
            return ret;
        },
        __wbg_WorkerGlobalScope_3099b3a1f65e307c: function(arg0) {
            const ret = arg0.WorkerGlobalScope;
            return ret;
        },
        __wbg___wbindgen_boolean_get_4f1baf9a00be3c74: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_f249a2a76caa9a55: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_is_function_741ff2bb612836f5: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_c22311b1cc228e3a: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_undefined_be5b34249ff1fc15: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_string_get_7ce8eee7fd327545: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_09736879a3f67559: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_beginComputePass_d7b46482cf2ed824: function(arg0, arg1) {
            const ret = arg0.beginComputePass(arg1);
            return ret;
        },
        __wbg_buffer_aca05a93c046db1a: function(arg0) {
            const ret = arg0.buffer;
            return ret;
        },
        __wbg_call_a410eb4b59ed5965: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_fc92fee6137d452d: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_copyBufferToBuffer_9227de77c8245eec: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.copyBufferToBuffer(arg1, arg2, arg3, arg4);
        }, arguments); },
        __wbg_copyBufferToBuffer_e4bc54903db1d3dc: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.copyBufferToBuffer(arg1, arg2, arg3, arg4, arg5);
        }, arguments); },
        __wbg_createBindGroup_2290306cfa413c74: function(arg0, arg1) {
            const ret = arg0.createBindGroup(arg1);
            return ret;
        },
        __wbg_createBuffer_30a700ffbc4c27c7: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.createBuffer(arg1);
            return ret;
        }, arguments); },
        __wbg_createCommandEncoder_80578730e7314357: function(arg0, arg1) {
            const ret = arg0.createCommandEncoder(arg1);
            return ret;
        },
        __wbg_createComputePipeline_78a3fff4e7d451a8: function(arg0, arg1) {
            const ret = arg0.createComputePipeline(arg1);
            return ret;
        },
        __wbg_createShaderModule_eb21a131dfb0d4dc: function(arg0, arg1) {
            const ret = arg0.createShaderModule(arg1);
            return ret;
        },
        __wbg_dispatchWorkgroups_88dfc3f2209b9d74: function(arg0, arg1, arg2, arg3) {
            arg0.dispatchWorkgroups(arg1 >>> 0, arg2 >>> 0, arg3 >>> 0);
        },
        __wbg_end_05c67c1822b40952: function(arg0) {
            arg0.end();
        },
        __wbg_engine_new: function(arg0) {
            const ret = Engine.__wrap(arg0);
            return ret;
        },
        __wbg_features_c348b716cae4abcf: function(arg0) {
            const ret = arg0.features;
            return ret;
        },
        __wbg_finish_073e2bc456a4b625: function(arg0) {
            const ret = arg0.finish();
            return ret;
        },
        __wbg_finish_e43b1b48427f2db0: function(arg0, arg1) {
            const ret = arg0.finish(arg1);
            return ret;
        },
        __wbg_getBindGroupLayout_111fe860e0f7c8d1: function(arg0, arg1) {
            const ret = arg0.getBindGroupLayout(arg1 >>> 0);
            return ret;
        },
        __wbg_getMappedRange_220dff11117bde93: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getMappedRange(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_getRandomValues_5d8c030b527203a6: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_gpu_155c1ef042219017: function(arg0) {
            const ret = arg0.gpu;
            return ret;
        },
        __wbg_has_abf74d2b4f3e578e: function(arg0, arg1, arg2) {
            const ret = arg0.has(getStringFromWasm0(arg1, arg2));
            return ret;
        },
        __wbg_instanceof_GpuAdapter_1c294ac02451317a: function(arg0) {
            let result;
            try {
                result = arg0 instanceof GPUAdapter;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_label_39beaf64ed23f7e1: function(arg0, arg1) {
            const ret = arg1.label;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 1, len1, true);
            getDataViewMemory0().setInt32((arg0 >>> 0) + 4 * 0, ptr1, true);
        },
        __wbg_length_186163212ffe79c3: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_limits_0c0185da58c966d2: function(arg0) {
            const ret = arg0.limits;
            return ret;
        },
        __wbg_mapAsync_1be2f9e8f464f69e: function(arg0, arg1, arg2, arg3) {
            const ret = arg0.mapAsync(arg1 >>> 0, arg2, arg3);
            return ret;
        },
        __wbg_maxBindGroups_e551f293ed7776b5: function(arg0) {
            const ret = arg0.maxBindGroups;
            return ret;
        },
        __wbg_maxBindingsPerBindGroup_cd69ad7931a27108: function(arg0) {
            const ret = arg0.maxBindingsPerBindGroup;
            return ret;
        },
        __wbg_maxBufferSize_a8a3aefb4c1d3094: function(arg0) {
            const ret = arg0.maxBufferSize;
            return ret;
        },
        __wbg_maxColorAttachmentBytesPerSample_c89c9cc4c455687b: function(arg0) {
            const ret = arg0.maxColorAttachmentBytesPerSample;
            return ret;
        },
        __wbg_maxColorAttachments_593438588b70d657: function(arg0) {
            const ret = arg0.maxColorAttachments;
            return ret;
        },
        __wbg_maxComputeInvocationsPerWorkgroup_4f8f30b8240bee77: function(arg0) {
            const ret = arg0.maxComputeInvocationsPerWorkgroup;
            return ret;
        },
        __wbg_maxComputeWorkgroupSizeX_e9b5a2c9caf1d541: function(arg0) {
            const ret = arg0.maxComputeWorkgroupSizeX;
            return ret;
        },
        __wbg_maxComputeWorkgroupSizeY_442f2865bedec5b5: function(arg0) {
            const ret = arg0.maxComputeWorkgroupSizeY;
            return ret;
        },
        __wbg_maxComputeWorkgroupSizeZ_63c04ed786636180: function(arg0) {
            const ret = arg0.maxComputeWorkgroupSizeZ;
            return ret;
        },
        __wbg_maxComputeWorkgroupStorageSize_d0ab80168adb50a3: function(arg0) {
            const ret = arg0.maxComputeWorkgroupStorageSize;
            return ret;
        },
        __wbg_maxComputeWorkgroupsPerDimension_8a10509eeac14230: function(arg0) {
            const ret = arg0.maxComputeWorkgroupsPerDimension;
            return ret;
        },
        __wbg_maxDynamicStorageBuffersPerPipelineLayout_0755c36c668523c8: function(arg0) {
            const ret = arg0.maxDynamicStorageBuffersPerPipelineLayout;
            return ret;
        },
        __wbg_maxDynamicUniformBuffersPerPipelineLayout_22a4017b847b2671: function(arg0) {
            const ret = arg0.maxDynamicUniformBuffersPerPipelineLayout;
            return ret;
        },
        __wbg_maxSampledTexturesPerShaderStage_a9eca78c1ebd2edf: function(arg0) {
            const ret = arg0.maxSampledTexturesPerShaderStage;
            return ret;
        },
        __wbg_maxSamplersPerShaderStage_ce7ba21d37dfcc1f: function(arg0) {
            const ret = arg0.maxSamplersPerShaderStage;
            return ret;
        },
        __wbg_maxStorageBufferBindingSize_a43f0f6b84339f4a: function(arg0) {
            const ret = arg0.maxStorageBufferBindingSize;
            return ret;
        },
        __wbg_maxStorageBuffersPerShaderStage_30046926bb9ee1fd: function(arg0) {
            const ret = arg0.maxStorageBuffersPerShaderStage;
            return ret;
        },
        __wbg_maxStorageTexturesPerShaderStage_70b826e698b878dd: function(arg0) {
            const ret = arg0.maxStorageTexturesPerShaderStage;
            return ret;
        },
        __wbg_maxTextureArrayLayers_910719c3411236bd: function(arg0) {
            const ret = arg0.maxTextureArrayLayers;
            return ret;
        },
        __wbg_maxTextureDimension1D_75dc6275076ccc5d: function(arg0) {
            const ret = arg0.maxTextureDimension1D;
            return ret;
        },
        __wbg_maxTextureDimension2D_c46a0d62e1b1ada7: function(arg0) {
            const ret = arg0.maxTextureDimension2D;
            return ret;
        },
        __wbg_maxTextureDimension3D_d74705ad9501c225: function(arg0) {
            const ret = arg0.maxTextureDimension3D;
            return ret;
        },
        __wbg_maxUniformBufferBindingSize_f5314509c534aba5: function(arg0) {
            const ret = arg0.maxUniformBufferBindingSize;
            return ret;
        },
        __wbg_maxUniformBuffersPerShaderStage_c5f92011bd1d0812: function(arg0) {
            const ret = arg0.maxUniformBuffersPerShaderStage;
            return ret;
        },
        __wbg_maxVertexAttributes_70606a90afc1566a: function(arg0) {
            const ret = arg0.maxVertexAttributes;
            return ret;
        },
        __wbg_maxVertexBufferArrayStride_4b3276cc8be7bedd: function(arg0) {
            const ret = arg0.maxVertexBufferArrayStride;
            return ret;
        },
        __wbg_maxVertexBuffers_f23570eed29f7da6: function(arg0) {
            const ret = arg0.maxVertexBuffers;
            return ret;
        },
        __wbg_minStorageBufferOffsetAlignment_9324bbb591f96679: function(arg0) {
            const ret = arg0.minStorageBufferOffsetAlignment;
            return ret;
        },
        __wbg_minUniformBufferOffsetAlignment_d6010aa3495e1a9e: function(arg0) {
            const ret = arg0.minUniformBufferOffsetAlignment;
            return ret;
        },
        __wbg_navigator_9641ab32fa612dd1: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_navigator_c17f443a6fe5d38d: function(arg0) {
            const ret = arg0.navigator;
            return ret;
        },
        __wbg_new_13de428334042d26: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_37eb45aaf5eeb820: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_cd4348290afae586: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_from_slice_3512352010266e02: function(arg0, arg1) {
            const ret = new Uint32Array(getArrayU32FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_from_slice_b8daf545a41c6aa0: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_e09da9dae6ee5935: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___js_sys_adfa250c9de6b6cd___Function_fn_wasm_bindgen_2514664e3b2c9a7c___JsValue_____wasm_bindgen_2514664e3b2c9a7c___sys__Undefined___js_sys_adfa250c9de6b6cd___Function_fn_wasm_bindgen_2514664e3b2c9a7c___JsValue_____wasm_bindgen_2514664e3b2c9a7c___sys__Undefined_______true_(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_byte_offset_and_length_3cd32055a417f095: function(arg0, arg1, arg2) {
            const ret = new Uint8Array(arg0, arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_now_463ac581d2fc7ea3: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_onSubmittedWorkDone_7d532ba1f20a64b3: function(arg0) {
            const ret = arg0.onSubmittedWorkDone();
            return ret;
        },
        __wbg_prototypesetcall_13162965d1fe7aa3: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_c9f4893fc209f768: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_1e8503a8a690f0a3: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_4a1a4d8dd332373b: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_queue_863f78dc0aeb7084: function(arg0) {
            const ret = arg0.queue;
            return ret;
        },
        __wbg_random_df36b90cd78a7d54: function() {
            const ret = Math.random();
            return ret;
        },
        __wbg_requestAdapter_8efca1b953fd13aa: function(arg0, arg1) {
            const ret = arg0.requestAdapter(arg1);
            return ret;
        },
        __wbg_requestDevice_290c73161fe959d5: function(arg0, arg1) {
            const ret = arg0.requestDevice(arg1);
            return ret;
        },
        __wbg_resolve_dbf78ab4942478b0: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_setBindGroup_1c8c11d4dd6528cf: function(arg0, arg1, arg2) {
            arg0.setBindGroup(arg1 >>> 0, arg2);
        },
        __wbg_setBindGroup_45468a6c5514aeef: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
            arg0.setBindGroup(arg1 >>> 0, arg2, getArrayU32FromWasm0(arg3, arg4), arg5, arg6 >>> 0);
        }, arguments); },
        __wbg_setPipeline_c91e0c8670443991: function(arg0, arg1) {
            arg0.setPipeline(arg1);
        },
        __wbg_set_118fefd528ab0a79: function(arg0, arg1, arg2) {
            arg0.set(arg1, arg2 >>> 0);
        },
        __wbg_set_2793479888329cb6: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_beginning_of_pass_write_index_4770dab84b33c99b: function(arg0, arg1) {
            arg0.beginningOfPassWriteIndex = arg1 >>> 0;
        },
        __wbg_set_binding_6884134d57cb42dc: function(arg0, arg1) {
            arg0.binding = arg1 >>> 0;
        },
        __wbg_set_buffer_b63620b1528127db: function(arg0, arg1) {
            arg0.buffer = arg1;
        },
        __wbg_set_code_807797f3d737b68f: function(arg0, arg1, arg2) {
            arg0.code = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_compute_dd8040358ecaa14e: function(arg0, arg1) {
            arg0.compute = arg1;
        },
        __wbg_set_end_of_pass_write_index_b3e58b4746026921: function(arg0, arg1) {
            arg0.endOfPassWriteIndex = arg1 >>> 0;
        },
        __wbg_set_entries_55c8b47b6023d084: function(arg0, arg1) {
            arg0.entries = arg1;
        },
        __wbg_set_entry_point_8219eb8ce38a15b9: function(arg0, arg1, arg2) {
            arg0.entryPoint = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_1ac8eff39e9de1ce: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_2ad20d9838679277: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_7324a280955bf607: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_a959d4f812507e2b: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_e378a1d54c5e851f: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_ef16f9c200c4b8a3: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_f0f0e248fd5edd0c: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_label_fe95a187450e62f8: function(arg0, arg1, arg2) {
            arg0.label = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_layout_206d502e5dc5e17e: function(arg0, arg1) {
            arg0.layout = arg1;
        },
        __wbg_set_layout_33e1fc76e68407f8: function(arg0, arg1) {
            arg0.layout = arg1;
        },
        __wbg_set_mapped_at_creation_a8deeccfb44b1d1c: function(arg0, arg1) {
            arg0.mappedAtCreation = arg1 !== 0;
        },
        __wbg_set_module_d7566ca591cf2923: function(arg0, arg1) {
            arg0.module = arg1;
        },
        __wbg_set_offset_3c313d6863b184f4: function(arg0, arg1) {
            arg0.offset = arg1;
        },
        __wbg_set_power_preference_19480684df2cc5cb: function(arg0, arg1) {
            arg0.powerPreference = __wbindgen_enum_GpuPowerPreference[arg1];
        },
        __wbg_set_query_set_d6d8e9a3be19f102: function(arg0, arg1) {
            arg0.querySet = arg1;
        },
        __wbg_set_required_features_f11b055ca5f67890: function(arg0, arg1) {
            arg0.requiredFeatures = arg1;
        },
        __wbg_set_resource_15e7ec322075540d: function(arg0, arg1) {
            arg0.resource = arg1;
        },
        __wbg_set_size_627e4faeb5647349: function(arg0, arg1) {
            arg0.size = arg1;
        },
        __wbg_set_size_a4f6aafbc392e3b3: function(arg0, arg1) {
            arg0.size = arg1;
        },
        __wbg_set_timestamp_writes_97da156b3a4464cd: function(arg0, arg1) {
            arg0.timestampWrites = arg1;
        },
        __wbg_set_usage_960ef4e0efff8e4e: function(arg0, arg1) {
            arg0.usage = arg1 >>> 0;
        },
        __wbg_static_accessor_GLOBAL_THIS_003ee833af9699fc: function() {
            const ret = typeof globalThis === 'undefined' ? undefined : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_e4293fb22cbe77da: function() {
            const ret = typeof global === 'undefined' ? undefined : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_53bb20457401453d: function() {
            const ret = typeof self === 'undefined' ? undefined : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b5e0810bfecb7feb: function() {
            const ret = typeof window === 'undefined' ? undefined : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_submit_21302eebe551e30d: function(arg0, arg1) {
            arg0.submit(arg1);
        },
        __wbg_then_656f253a5dd7d8ea: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_7ede85da03ac5cd0: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_e3f7f2d365708be8: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_unmap_b819b8b402db13cc: function(arg0) {
            arg0.unmap();
        },
        __wbg_writeBuffer_284d7eb61c74f57a: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.writeBuffer(arg1, arg2, arg3, arg4, arg5);
        }, arguments); },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 193, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___wasm_bindgen_2514664e3b2c9a7c___JsValue______true_);
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 225, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___wasm_bindgen_2514664e3b2c9a7c___JsValue__core_d941ad8722425d2e___result__Result_____wasm_bindgen_2514664e3b2c9a7c___JsError___true_);
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000005: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./lfm3_web_bg.js": import0,
    };
}

function wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___wasm_bindgen_2514664e3b2c9a7c___JsValue______true_(arg0, arg1, arg2) {
    wasm.wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___wasm_bindgen_2514664e3b2c9a7c___JsValue______true_(arg0, arg1, arg2);
}

function wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___wasm_bindgen_2514664e3b2c9a7c___JsValue__core_d941ad8722425d2e___result__Result_____wasm_bindgen_2514664e3b2c9a7c___JsError___true_(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___wasm_bindgen_2514664e3b2c9a7c___JsValue__core_d941ad8722425d2e___result__Result_____wasm_bindgen_2514664e3b2c9a7c___JsError___true_(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___js_sys_adfa250c9de6b6cd___Function_fn_wasm_bindgen_2514664e3b2c9a7c___JsValue_____wasm_bindgen_2514664e3b2c9a7c___sys__Undefined___js_sys_adfa250c9de6b6cd___Function_fn_wasm_bindgen_2514664e3b2c9a7c___JsValue_____wasm_bindgen_2514664e3b2c9a7c___sys__Undefined_______true_(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen_2514664e3b2c9a7c___convert__closures_____invoke___js_sys_adfa250c9de6b6cd___Function_fn_wasm_bindgen_2514664e3b2c9a7c___JsValue_____wasm_bindgen_2514664e3b2c9a7c___sys__Undefined___js_sys_adfa250c9de6b6cd___Function_fn_wasm_bindgen_2514664e3b2c9a7c___JsValue_____wasm_bindgen_2514664e3b2c9a7c___sys__Undefined_______true_(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_GpuPowerPreference = ["low-power", "high-performance"];
const EngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_engine_free(ptr, 1));
const TextStreamFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_textstream_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    switch (typeof val) {
        // primitive types
        case 'number':
        case 'boolean':
        case 'undefined':
        return `${val}`;
        case 'string':
        return JSON.stringify(val);
        case 'bigint':
        return `${val}n`;
        case 'symbol':
        return val.description !== undefined
            ? `Symbol(${val.description})`
            : 'Symbol';
        case 'function':
        return typeof val.name === 'string' && val.name !== ''
            ? `Function(${val.name})`
            : 'Function';
        case 'object': {
            if (val === null) {
                return 'null';
            }
            // objects
            if (Array.isArray(val)) {
                return '[' + Array.from(val, debugString).join(', ') + ']';
            }
            // errors
            if (val instanceof Error) {
                return `${val.name}: ${val.message}\n${val.stack}`;
            }

            const toStringOutput = toString.call(val);
            // Test for built-in
            const className = /\[object ([^\]]+)\]/.exec(toStringOutput)?.[1];

            // Failed to match the standard '[object ClassName]'
            if (className === undefined) {
                return toStringOutput;
            }
            if (className === 'Object') {
                // we're a user defined class or Object
                // JSON.stringify avoids problems with cycles, and is generally much
                // easier than looping through ownProperties of `val`.
                try {
                    return 'Object(' + JSON.stringify(val) + ')';
                } catch (_) {
                    return 'Object';
                }
            }
            // TODO we could test for more things here, like `Set`s and `Map`s.
            return className;
        }
        // Per MDN: 'This list of values is exhaustive.'
        // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/typeof#description
    }
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('lfm3_web_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
