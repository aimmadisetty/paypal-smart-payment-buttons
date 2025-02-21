/* @flow */

import { ZalgoPromise } from '@krakenjs/zalgo-promise/src';
import { memoize, redirect as redir } from '@krakenjs/belter/src';
import { INTENT, FPTI_KEY } from '@paypal/sdk-constants/src';

import { getLogger, promiseNoop } from '../lib';
import { FPTI_TRANSITION, FPTI_CONTEXT_TYPE, LSAT_UPGRADE_EXCLUDED_MERCHANTS } from '../constants';
import { getOrder, type OrderResponse } from '../api';

import type { CreateOrder } from './createOrder';
import type { OnError } from './onError';


export type OnCompleteData = {|
    payerID? : ?string,
    paymentID? : ?string,
    billingToken? : ?string,
    subscriptionID? : ?string,
    buyerAccessToken? : ?string,
    authCode? : ?string,
    forceRestAPI? : boolean,
    paymentMethodToken? : string
|};

export type OnComplete = (OnCompleteData) => ZalgoPromise<void>;

export type XOnCompleteData = {|
    orderID : string,
    intent : $Values<typeof INTENT>
|};

export type XonCompleteOrderActions = {|
    get : () => ZalgoPromise<OrderResponse>
|};

export type XOnCompleteActions = {|
    order : XonCompleteOrderActions,
    redirect : (string) => ZalgoPromise<void>
|};
export type XOnComplete = (XOnCompleteData, XOnCompleteActions) => ZalgoPromise<void>;

type OnCompleteActionOptions = {|
    orderID : string,
    facilitatorAccessToken : string,
    buyerAccessToken : ?string,
    partnerAttributionID : ?string,
    forceRestAPI : boolean,
    onError : OnError
|};

type GetOnCompleteOptions = {|
    intent : $Values<typeof INTENT>,
    onComplete : ?XOnComplete,
    partnerAttributionID : ?string,
    onError : OnError,
    clientID : string,
    facilitatorAccessToken : string,
    createOrder : CreateOrder,
|};

const redirect = (url) => {
    if (!url) {
        throw new Error(`Expected redirect url`);
    }

    if (url.indexOf('://') === -1) {
        getLogger().warn('redir_url_non_scheme', { url }).flush();
        throw new Error(`Invalid redirect url: ${ url } - must be fully qualified url`);
    } else if (!url.match(/^https?:\/\//)) {
        getLogger().warn('redir_url_non_http', { url }).flush();
    }

    return redir(url, window.top);
};

const buildOnCompleteActions = ({ orderID, facilitatorAccessToken, buyerAccessToken, partnerAttributionID, forceRestAPI } : OnCompleteActionOptions) : XOnCompleteActions => {
    const get = memoize(() => {
        return getOrder(orderID, { facilitatorAccessToken, buyerAccessToken, partnerAttributionID, forceRestAPI })
            .finally(get.reset);
    });

    return {
        order: {
            get
        },
        redirect
    };
};

export function getOnComplete({ intent, onComplete, partnerAttributionID, onError, clientID, facilitatorAccessToken, createOrder } : GetOnCompleteOptions) : OnComplete {
    if (!onComplete) {
        return promiseNoop;
    }

    const upgradeLSAT = LSAT_UPGRADE_EXCLUDED_MERCHANTS.indexOf(clientID) === -1;

    return memoize(({ buyerAccessToken, forceRestAPI = upgradeLSAT } : OnCompleteData) => {
        return createOrder().then(orderID => {
            getLogger()
                .info('button_complete')
                .track({
                    [FPTI_KEY.TRANSITION]:   FPTI_TRANSITION.CHECKOUT_COMPLETE,
                    [FPTI_KEY.EVENT_NAME]:   FPTI_TRANSITION.CHECKOUT_COMPLETE,
                    [FPTI_KEY.CONTEXT_TYPE]: FPTI_CONTEXT_TYPE.ORDER_ID,
                    [FPTI_KEY.TOKEN]:        orderID,
                    [FPTI_KEY.CONTEXT_ID]:   orderID
                }).flush();
            const actions = buildOnCompleteActions({ orderID, facilitatorAccessToken, buyerAccessToken, partnerAttributionID, forceRestAPI, onError });

            return onComplete({ orderID, intent }, actions).catch(err => {
                return ZalgoPromise.try(() => {
                    return onError(err);
                }).then(() => {
                    throw err;
                });
            });
        });
    });
}
