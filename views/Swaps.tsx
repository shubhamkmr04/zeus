import * as React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { inject, observer } from 'mobx-react';
import { StackNavigationProp } from '@react-navigation/stack';
import BigNumber from 'bignumber.js';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { crypto } from 'bitcoinjs-lib';
import bolt11 from 'bolt11';
import { randomBytes } from 'crypto';
import zkpInit from '@vulpemventures/secp256k1-zkp';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { Musig, SwapTreeSerializer, TaprootUtils } from 'boltz-core';

import SwapStore from '../stores/SwapStore';
import UnitsStore, { SATS_PER_BTC } from '../stores/UnitsStore';

import Amount from '../components/Amount';
import Button from '../components/Button';
import Header from '../components/Header';
import { Row } from '../components/layout/Row';
import Screen from '../components/Screen';
import Text from '../components/Text';
import AmountInput from '../components/AmountInput';
import LoadingIndicator from '../components/LoadingIndicator';

import { localeString } from '../utils/LocaleUtils';
import { themeColor } from '../utils/ThemeUtils';

import ArrowDown from '../assets/images/SVG/Arrow_down.svg';
import OnChainSvg from '../assets/images/SVG/DynamicSVG/OnChainSvg';
import LightningSvg from '../assets/images/SVG/DynamicSVG/LightningSvg';

interface SwapPaneProps {
    navigation: StackNavigationProp<any, any>;
    SwapStore: SwapStore;
    UnitsStore: UnitsStore;
}

interface SwapPaneState {
    reverse: boolean;
    serviceFeeSats: number | any;
    inputSats: number | any;
    outputSats: number | any;
}

@inject('SwapStore', 'UnitsStore')
@observer
export default class SwapPane extends React.PureComponent<
    SwapPaneProps,
    SwapPaneState
> {
    state = {
        reverse: false,
        serviceFeeSats: 0,
        inputSats: 0,
        outputSats: 0
    };

    async UNSAFE_componentWillMount() {
        this.props.SwapStore.getSwapFees();
    }

    render() {
        const { SwapStore, UnitsStore, navigation } = this.props;
        const { reverse, serviceFeeSats, inputSats, outputSats } = this.state;
        const { subInfo, reverseInfo, loading } = SwapStore;
        const info: any = reverse ? reverseInfo : subInfo;
        const { units } = UnitsStore;

        const serviceFeePct = info?.fees?.percentage || 0;
        const networkFee = reverse
            ? new BigNumber(info?.fees?.minerFees?.claim || 0).plus(
                  info?.fees?.minerFees?.lockup || 0
              )
            : info?.fees?.minerFees || 0;

        const bigCeil = (big: BigNumber): BigNumber => {
            return big.integerValue(BigNumber.ROUND_CEIL);
        };

        const bigFloor = (big: BigNumber): BigNumber => {
            return big.integerValue(BigNumber.ROUND_FLOOR);
        };

        const keys = ECPairFactory(ecc).makeRandom();

        const endpoint = 'https://api.testnet.boltz.exchange/v2';

        const subscribeToWebSocket = (createdResponse: any) => {
            // Create a WebSocket connection
            const webSocket = new WebSocket(
                `${endpoint.replace('http://', 'ws://')}/ws`
            );
            // Handle the 'open' event
            webSocket.onopen = () => {
                webSocket.send(
                    JSON.stringify({
                        op: 'subscribe',
                        channel: 'swap.update',
                        args: [createdResponse.id]
                    })
                );
                console.log(
                    'WebSocket connection established and subscription sent.'
                );
            };
            // Handle incoming messages
            webSocket.onmessage = async (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.event !== 'update') {
                        return;
                    }
                    console.log('Got WebSocket update');
                    console.log(msg);
                    switch (msg.args[0].status) {
                        case 'invoice.set': {
                            console.log('Waiting for onchain transaction...');
                            break;
                        }
                        case 'transaction.claim.pending': {
                            console.log(
                                'Creating cooperative claim transaction'
                            );

                            // Get the information request to create a partial signature
                            const claimTxDetails = (
                                await ReactNativeBlobUtil.fetch(
                                    'GET',
                                    `${endpoint}/swap/submarine/${createdResponse.id}/claim`,
                                    { 'Content-Type': 'application/json' }
                                )
                            ).data;

                            console.log(
                                'Claim transaction details:',
                                claimTxDetails
                            );

                            // Verify that Boltz actually paid the invoice by comparing the preimage hash
                            // of the invoice to the SHA256 hash of the preimage from the response
                            const invoicePreimageHash = Buffer.from(
                                bolt11
                                    .decode(
                                        'lntb8m1pnntkwkpp5e42vyu2swfn0xnqpc5807h4mjweasy62lyz3rlnthtqr3d843s9sdqqcqzzsxqrrsssp54s97dejh8xerqvjhe59xfqe0rwhmf53slrcelaxajla7d6lrqkjq9p4gqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqysgq0khu5u9mx0v2g77x0t2t24mkcjps2ul5fp80cf6ac4867028u9sy7k5uqm7hqqttsyjnexays2n0yv9y6wkld85x988hrygsufpu0xsqzvazws'
                                    )
                                    .tags.find(
                                        (tag: any) =>
                                            tag.tagName === 'payment_hash'
                                    )!.data as string,
                                'hex'
                            );
                            if (
                                !crypto
                                    .sha256(
                                        Buffer.from(
                                            claimTxDetails.preimage,
                                            'hex'
                                        )
                                    )
                                    .equals(invoicePreimageHash)
                            ) {
                                console.error(
                                    'Boltz provided invalid preimage'
                                );
                                return;
                            } else {
                                console.log('lesssgoooo....');
                            }

                            const boltzPublicKey = Buffer.from(
                                createdResponse.claimPublicKey,
                                'hex'
                            );

                            // const pk =
                            //     '02758997f184be06f4350b136db0bed6f8af27cf732576db66d311dade77ba3c53';

                            // Create a musig signing instance
                            const musig = new Musig(
                                await zkpInit(),
                                keys,
                                randomBytes(32),
                                [boltzPublicKey, keys.publicKey]
                            );

                            // // Tweak that musig with the Taptree of the swap scripts
                            TaprootUtils.tweakMusig(
                                musig,
                                SwapTreeSerializer.deserializeSwapTree(
                                    createdResponse.swapTree
                                ).tree
                            );

                            // Aggregate the nonces
                            musig.aggregateNonces([
                                [
                                    boltzPublicKey,
                                    Buffer.from(claimTxDetails.pubNonce, 'hex')
                                ]
                            ]);

                            // // // Initialize the session to sign the transaction hash from the response
                            musig.initializeSession(
                                Buffer.from(
                                    claimTxDetails.transactionHash,
                                    'hex'
                                )
                            );

                            // // Give our public nonce and the partial signature to Boltz
                            await ReactNativeBlobUtil.fetch(
                                'POST',
                                `${endpoint}/swap/submarine/${createdResponse.id}/claim`,
                                { 'Content-Type': 'application/json' },
                                JSON.stringify({
                                    pubNonce: Buffer.from(
                                        musig.getPublicNonce()
                                    ).toString('hex'),
                                    partialSignature: Buffer.from(
                                        musig.signPartial()
                                    ).toString('hex')
                                })
                            );

                            break;
                        }
                        case 'transaction.claimed': {
                            console.log('Swap successful');
                            webSocket.close();
                            break;
                        }
                    }
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };
            // Handle errors
            webSocket.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
            // Handle the 'close' event
            webSocket.onclose = (event) => {
                console.log(
                    'WebSocket connection closed:',
                    event.reason || 'No reason provided.'
                );
            };
            return webSocket;
        };

        const createSubmarineSwap = async (invoice: any) => {
            try {
                console.log('test');
                const response = await ReactNativeBlobUtil.fetch(
                    'POST',
                    `${endpoint}/swap/submarine`,
                    {
                        'Content-Type': 'application/json'
                    },
                    JSON.stringify({
                        invoice,
                        to: 'BTC',
                        from: 'BTC',
                        refundPublicKey: keys.publicKey.toString('hex')
                    })
                );
                console.log('Status Code:', response.info().status);
                console.log('Response:', response.data);
                subscribeToWebSocket(response.data);
                // // return response.data;
            } catch (error) {
                console.error('Error creating Submarine Swap:', error);
                throw error;
            }
        };

        const calculateReceiveAmount = (
            sendAmount: BigNumber,
            serviceFee: number,
            minerFee: number
        ): BigNumber => {
            const receiveAmount = reverse
                ? sendAmount
                      .minus(bigCeil(sendAmount.times(serviceFee).div(100)))
                      .minus(minerFee)
                : sendAmount
                      .minus(minerFee)
                      .div(
                          new BigNumber(1).plus(
                              new BigNumber(serviceFee).div(100)
                          )
                      );
            return BigNumber.maximum(bigFloor(receiveAmount), 0);
        };

        const calculateServiceFeeOnSend = (
            sendAmount: BigNumber,
            serviceFee: number,
            minerFee: number
        ): BigNumber => {
            if (sendAmount.isNaN()) {
                return new BigNumber(0);
            }

            let fee: BigNumber;

            if (reverse) {
                fee = bigCeil(sendAmount.times(serviceFee).div(100));
            } else {
                fee = sendAmount
                    .minus(
                        calculateReceiveAmount(sendAmount, serviceFee, minerFee)
                    )
                    .minus(minerFee);

                if (sendAmount.toNumber() < minerFee) {
                    fee = new BigNumber(0);
                }
            }

            return bigCeil(fee);
        };

        const calculateSendAmount = (
            receiveAmount: BigNumber,
            serviceFee: number,
            minerFee: number
        ): BigNumber => {
            return reverse
                ? bigCeil(
                      receiveAmount
                          .plus(minerFee)
                          .div(
                              new BigNumber(1).minus(
                                  new BigNumber(serviceFee).div(100)
                              )
                          )
                  )
                : bigFloor(
                      receiveAmount
                          .plus(
                              bigCeil(
                                  receiveAmount.times(
                                      new BigNumber(serviceFee).div(100)
                                  )
                              )
                          )
                          .plus(minerFee)
                  );
        };

        const calculateLimit = (limit: number): number => {
            return !reverse
                ? calculateSendAmount(
                      new BigNumber(limit),
                      serviceFeePct,
                      networkFee
                  ).toNumber()
                : limit;
        };

        const min = calculateLimit(info?.limits?.minimal || 0);
        const max = calculateLimit(info?.limits?.maximal || 0);

        const errorInput =
            (inputSats !== 0 && inputSats < min) || inputSats > max;
        const errorOutput = outputSats < 0;
        const error = errorInput || errorOutput;

        return (
            <Screen>
                <Header
                    leftComponent="Back"
                    centerComponent={{
                        text: localeString('views.Swaps.title'),
                        style: {
                            color: themeColor('text'),
                            fontFamily: 'PPNeueMontreal-Book'
                        }
                    }}
                    navigation={navigation}
                />
                <View style={{ flex: 1, margin: 10 }}>
                    {loading && <LoadingIndicator />}
                    {!loading && (
                        <>
                            <View style={{ alignItems: 'center' }}>
                                <Text
                                    style={{
                                        fontFamily: 'PPNeueMontreal-Book',
                                        fontSize: 20,
                                        marginBottom: 20
                                    }}
                                >
                                    {localeString('views.Swaps.create')}
                                </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                                <View style={{ flex: 1 }}>
                                    <Row
                                        style={{
                                            position: 'absolute',
                                            zIndex: 1
                                        }}
                                    >
                                        <AmountInput
                                            prefix={
                                                <View
                                                    style={{ marginLeft: -10 }}
                                                >
                                                    {reverse ? (
                                                        <LightningSvg
                                                            width={60}
                                                        />
                                                    ) : (
                                                        <OnChainSvg
                                                            width={60}
                                                        />
                                                    )}
                                                </View>
                                            }
                                            onAmountChange={(
                                                _,
                                                satAmount: string | number
                                            ) => {
                                                if (
                                                    !satAmount ||
                                                    satAmount === '0'
                                                ) {
                                                    this.setState({
                                                        serviceFeeSats: 0,
                                                        outputSats: 0
                                                    });
                                                }

                                                const satAmountNew =
                                                    new BigNumber(
                                                        satAmount || 0
                                                    );

                                                const outputSats =
                                                    calculateReceiveAmount(
                                                        satAmountNew,
                                                        serviceFeePct,
                                                        networkFee
                                                    );

                                                this.setState({
                                                    serviceFeeSats:
                                                        calculateServiceFeeOnSend(
                                                            satAmountNew,
                                                            serviceFeePct,
                                                            networkFee
                                                        ),
                                                    inputSats:
                                                        Number(satAmount),
                                                    outputSats
                                                });
                                            }}
                                            sats={
                                                inputSats
                                                    ? inputSats.toString()
                                                    : ''
                                            }
                                            hideConversion
                                            error={errorInput}
                                        />
                                    </Row>
                                    <TouchableOpacity
                                        style={{
                                            alignSelf: 'center',
                                            position: 'absolute',
                                            zIndex: 100,
                                            top: 50
                                        }}
                                        onPress={() => {
                                            this.setState({
                                                reverse: !reverse,
                                                inputSats: 0,
                                                outputSats: 0,
                                                serviceFeeSats: 0
                                            });
                                        }}
                                    >
                                        <View
                                            style={{
                                                backgroundColor:
                                                    themeColor('background'),
                                                borderRadius: 30,
                                                padding: 10
                                            }}
                                        >
                                            <ArrowDown
                                                fill={themeColor('text')}
                                                height="30"
                                                width="30"
                                            />
                                        </View>
                                    </TouchableOpacity>
                                    <View style={{ zIndex: 2 }}>
                                        <Row
                                            style={{
                                                position: 'absolute',
                                                zIndex: 1,
                                                top: 70
                                            }}
                                        >
                                            <AmountInput
                                                prefix={
                                                    <View
                                                        style={{
                                                            marginLeft: -10
                                                        }}
                                                    >
                                                        {reverse ? (
                                                            <OnChainSvg
                                                                width={60}
                                                            />
                                                        ) : (
                                                            <LightningSvg
                                                                width={60}
                                                            />
                                                        )}
                                                    </View>
                                                }
                                                onAmountChange={(
                                                    _,
                                                    satAmount: string | number
                                                ) => {
                                                    if (
                                                        !satAmount ||
                                                        satAmount === '0'
                                                    ) {
                                                        this.setState({
                                                            serviceFeeSats: 0,
                                                            inputSats: 0
                                                        });
                                                    }

                                                    const satAmountNew =
                                                        new BigNumber(
                                                            satAmount || 0
                                                        );

                                                    let input: any;
                                                    if (
                                                        satAmountNew.isEqualTo(
                                                            0
                                                        )
                                                    ) {
                                                        input = 0;
                                                    } else
                                                        input =
                                                            calculateSendAmount(
                                                                satAmountNew,
                                                                serviceFeePct,
                                                                networkFee
                                                            );

                                                    const serviceFeeSats =
                                                        reverse && input
                                                            ? input
                                                                  .times(
                                                                      serviceFeePct
                                                                  )
                                                                  .div(100)
                                                            : satAmountNew
                                                                  .times(
                                                                      serviceFeePct
                                                                  )
                                                                  .div(100);

                                                    this.setState({
                                                        serviceFeeSats:
                                                            bigCeil(
                                                                serviceFeeSats
                                                            ),
                                                        inputSats: input,
                                                        outputSats:
                                                            Number(satAmount)
                                                    });
                                                }}
                                                hideConversion
                                                sats={
                                                    outputSats
                                                        ? outputSats.toString()
                                                        : ''
                                                }
                                                error={errorOutput}
                                            />
                                        </Row>
                                    </View>
                                    <Row justify="space-between">
                                        <View style={{ top: 165 }}>
                                            <Row>
                                                <Text
                                                    style={{
                                                        fontFamily:
                                                            'PPNeueMontreal-Book'
                                                    }}
                                                >
                                                    Network fee:{' '}
                                                </Text>
                                                <Amount sats={networkFee} />
                                            </Row>
                                            <Row>
                                                <Text
                                                    style={{
                                                        fontFamily:
                                                            'PPNeueMontreal-Book'
                                                    }}
                                                >
                                                    Service fee:{' '}
                                                </Text>
                                                <Amount sats={serviceFeeSats} />
                                                <Text
                                                    style={{
                                                        fontFamily:
                                                            'PPNeueMontreal-Book'
                                                    }}
                                                >
                                                    {' '}
                                                    ({serviceFeePct}%)
                                                </Text>
                                            </Row>
                                        </View>
                                        <View style={{ top: 165 }}>
                                            <Row>
                                                <Text
                                                    style={{
                                                        fontFamily:
                                                            'PPNeueMontreal-Book'
                                                    }}
                                                >
                                                    Min:{' '}
                                                </Text>
                                                <Amount sats={min} />
                                            </Row>
                                            <Row>
                                                <Text
                                                    style={{
                                                        fontFamily:
                                                            'PPNeueMontreal-Book'
                                                    }}
                                                >
                                                    Max:{' '}
                                                </Text>
                                                <Amount sats={max} />
                                            </Row>
                                        </View>
                                    </Row>
                                </View>
                            </View>
                            <View>
                                <Button
                                    onPress={() => {
                                        console.log(
                                            outputSats,
                                            outputSats.toString()
                                        );
                                        navigation.navigate('Receive', {
                                            amount:
                                                units === 'sats'
                                                    ? outputSats
                                                    : units === 'BTC'
                                                    ? new BigNumber(outputSats)
                                                          .div(SATS_PER_BTC)
                                                          .toFixed(8)
                                                    : '',
                                            selectedIndex: reverse ? 2 : 1,
                                            autoGenerate: true
                                        });
                                    }}
                                    title={
                                        !reverse
                                            ? 'Generate Invoice'
                                            : 'Create Onchain Address'
                                    }
                                    disabled={true}
                                />
                            </View>
                            <View>
                                <Button
                                    title="Create Atomic Swap"
                                    onPress={() => {
                                        createSubmarineSwap(
                                            'lntb5420u1pnntkrlpp59datplrp52djz7w22kr6xgv6a56pur530rtlyc6g92t4hefkp6nqdqqcqzzsxqrrsssp5rdsth9ssflqvvwp8xjcknrwxa57wfmlkjwedu8g23kh732d86q4s9p4gqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqysgqd0upcj8ppyl56ycj73tjhgj7em4djvm23n807mhwxpwpknw49nph63678p0rfmadvju3vcsh7md44umgu3sfwlhnjlr2w89e6dn3nxgp4ujwa4'
                                        );
                                    }}
                                    secondary
                                    containerStyle={{ marginTop: 14 }}
                                />
                            </View>
                        </>
                    )}
                </View>
            </Screen>
        );
    }
}
