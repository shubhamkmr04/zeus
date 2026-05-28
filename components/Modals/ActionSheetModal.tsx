import React from 'react';
import {
    View,
    StyleSheet,
    Text,
    TouchableOpacity,
    ScrollView
} from 'react-native';
import { inject, observer } from 'mobx-react';

import ModalBox from '../ModalBox';
import ModalStore from '../../stores/ModalStore';
import { localeString } from '../../utils/LocaleUtils';
import { themeColor } from '../../utils/ThemeUtils';

export interface ActionSheetItem {
    label: string;
    value: any;
    isHeader?: boolean;
    isSelected?: boolean;
}

interface ActionSheetModalProps {
    ModalStore?: ModalStore;
}

@inject('ModalStore')
@observer
export default class ActionSheetModal extends React.Component<
    ActionSheetModalProps,
    {}
> {
    render() {
        const { ModalStore } = this.props;
        const { showActionSheet, actionSheetItems, actionSheetOnSelect } =
            ModalStore!;

        const close = () => ModalStore!.toggleActionSheet();

        return (
            <ModalBox
                isOpen={showActionSheet}
                onClosed={close}
                position="bottom"
                swipeToClose={true}
                backdropPressToClose={true}
                style={{
                    backgroundColor: 'transparent',
                    height: 'auto'
                }}
            >
                <View style={styles.container}>
                    <View
                        style={{
                            ...styles.group,
                            backgroundColor: themeColor('modalBackground')
                        }}
                    >
                        <ScrollView
                            bounces={false}
                            showsVerticalScrollIndicator={false}
                        >
                            {actionSheetItems.map(
                                (item: ActionSheetItem, i) => (
                                    <TouchableOpacity
                                        key={`${item.label}-${i}`}
                                        disabled={item.isHeader}
                                        onPress={() => {
                                            if (!item.isHeader) {
                                                actionSheetOnSelect?.(
                                                    item.value
                                                );
                                            }
                                            close();
                                        }}
                                        style={[
                                            styles.row,
                                            i !==
                                                actionSheetItems.length - 1 && {
                                                borderBottomWidth: 0.5,
                                                borderBottomColor:
                                                    themeColor('separator')
                                            }
                                        ]}
                                    >
                                        <Text
                                            style={{
                                                ...styles.rowText,
                                                color: item.isHeader
                                                    ? themeColor(
                                                          'secondaryText'
                                                      )
                                                    : themeColor('text'),
                                                fontFamily: item.isSelected
                                                    ? 'PPNeueMontreal-Medium'
                                                    : 'PPNeueMontreal-Book'
                                            }}
                                        >
                                            {item.label}
                                        </Text>
                                    </TouchableOpacity>
                                )
                            )}
                        </ScrollView>
                    </View>
                    <TouchableOpacity
                        onPress={close}
                        style={{
                            ...styles.cancel,
                            backgroundColor: themeColor('modalBackground')
                        }}
                    >
                        <Text
                            style={{
                                ...styles.cancelText,
                                color: themeColor('text')
                            }}
                        >
                            {localeString('general.cancel')}
                        </Text>
                    </TouchableOpacity>
                </View>
            </ModalBox>
        );
    }
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 10,
        paddingBottom: 30
    },
    group: {
        borderRadius: 14,
        overflow: 'hidden',
        maxHeight: 400
    },
    row: {
        paddingVertical: 16,
        paddingHorizontal: 20,
        alignItems: 'center'
    },
    rowText: {
        fontSize: 18
    },
    cancel: {
        marginTop: 8,
        borderRadius: 14,
        paddingVertical: 16,
        alignItems: 'center'
    },
    cancelText: {
        fontSize: 18,
        fontFamily: 'PPNeueMontreal-Medium'
    }
});
